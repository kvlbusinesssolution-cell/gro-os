import { prisma } from "@/lib/prisma";
import type { SuppressionReason, DraftChannel } from "@/generated/prisma/client";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — the single
 * suppression choke-point every send path must go through. Fixes a real,
 * confirmed gap: before this phase, only `Contact.status === UNSUBSCRIBED`
 * was checked, only by the manual/scheduled-send path — `bouncedAt`/
 * `complainedAt` were never checked anywhere, and KVL's own automated
 * first-touch path (kvl-sector-discovery-job.ts) checked neither. This is
 * wired into `sendOutreachEmail` (email-provider.ts) so every provider
 * (Gmail/Outlook/Resend/SMTP) and every caller benefits from one edit.
 *
 * Phase 8 (WhatsApp Business Outreach) / Phase 10 (AI Voice Sales Engine)
 * — extended in place with a `channel` parameter (default EMAIL, so every
 * existing caller is unaffected) rather than a second suppression system
 * per phase, per each phase's explicit rule. WHATSAPP and VOICE are both
 * keyed on phone number instead of email; the EMAIL-only bounce/complaint
 * fallback checks below are deliberately skipped for both (that reasoning
 * is email-specific — WhatsApp/Voice each have their own opt-out
 * mechanism, see whatsapp-provider.ts / voice-eligibility.ts).
 */

const PHONE_KEYED_CHANNELS = new Set<DraftChannel>(["WHATSAPP", "VOICE"]);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SuppressionCheckResult {
  suppressed: boolean;
  reason?: SuppressionReason;
  detail?: string;
}

/**
 * Checks, in order of certainty: (1) the real `SuppressionEntry` table
 * (global row with organizationId=null, or tenant-scoped row) — the fast,
 * indexed path a healthy system hits on every send; (2) as a defense-in-
 * depth fallback for anything not yet backfilled into that table,
 * `Contact.status === UNSUBSCRIBED` and any real `bouncedAt`/`complainedAt`
 * on a prior `EmailDraft` to the same email in this org.
 */
export async function checkSuppression(organizationId: string, identifier: string, channel: DraftChannel = "EMAIL"): Promise<SuppressionCheckResult> {
  if (PHONE_KEYED_CHANNELS.has(channel)) return checkPhoneKeyedSuppression(organizationId, channel, identifier);

  const normalized = normalizeEmail(identifier);

  const entry = await prisma.suppressionEntry.findUnique({ where: { organizationId_channel_email: { organizationId, channel: "EMAIL", email: normalized } } });
  if (entry) return { suppressed: true, reason: entry.reason, detail: `Suppressed (${entry.reason}) via ${entry.source}.` };

  const contact = await prisma.contact.findFirst({ where: { organizationId, email: { equals: normalized, mode: "insensitive" } } });
  if (contact?.status === "UNSUBSCRIBED") {
    await addSuppressionEntry({ organizationId, identifier: normalized, reason: "UNSUBSCRIBED", source: "Contact.status backfill" });
    return { suppressed: true, reason: "UNSUBSCRIBED", detail: "Contact status is UNSUBSCRIBED." };
  }

  if (contact) {
    const priorBounceOrComplaint = await prisma.emailDraft.findFirst({
      where: { organizationId, contactId: contact.id, OR: [{ bouncedAt: { not: null } }, { complainedAt: { not: null } }] },
      orderBy: { createdAt: "desc" },
    });
    if (priorBounceOrComplaint?.complainedAt) {
      await addSuppressionEntry({ organizationId, identifier: normalized, reason: "SPAM_COMPLAINT", source: "EmailDraft.complainedAt backfill" });
      return { suppressed: true, reason: "SPAM_COMPLAINT", detail: "A prior email to this address received a spam complaint." };
    }
    if (priorBounceOrComplaint?.bouncedAt) {
      const isHard = priorBounceOrComplaint.bounceType !== "soft"; // unknown bounce type is treated conservatively as suppress-worthy
      if (isHard) {
        await addSuppressionEntry({ organizationId, identifier: normalized, reason: "HARD_BOUNCE", source: "EmailDraft.bouncedAt backfill" });
        return { suppressed: true, reason: "HARD_BOUNCE", detail: "A prior email to this address hard-bounced." };
      }

      // §14 "repeated soft bounce: escalate to suppression" — a genuinely
      // soft-classified bounce alone allows a controlled retry (not
      // suppressed above), but SOFT_BOUNCE_ESCALATION_THRESHOLD real soft
      // bounces to the same address is no longer "transient" by definition
      // and escalates to suppression. Never retries indefinitely.
      const softBounceCount = await prisma.emailDraft.count({ where: { organizationId, contactId: contact.id, bouncedAt: { not: null }, bounceType: "soft" } });
      if (softBounceCount >= SOFT_BOUNCE_ESCALATION_THRESHOLD) {
        await addSuppressionEntry({ organizationId, identifier: normalized, reason: "HARD_BOUNCE", source: `${softBounceCount} repeated soft bounces — escalated` });
        return { suppressed: true, reason: "HARD_BOUNCE", detail: `${softBounceCount} repeated soft bounces to this address — escalated to suppression.` };
      }
    }
  }

  return { suppressed: false };
}

// §14/§21 — documented, configurable escalation threshold.
const SOFT_BOUNCE_ESCALATION_THRESHOLD = 3;

/**
 * WhatsApp/Voice opt-out check (§6/§7) — keyed on phone number, no
 * email/bounce concepts. Real `SuppressionEntry` rows only; there is no
 * bounce-backfill fallback here because neither channel has a bounce
 * concept in this app — opt-outs arrive only via a real inbound STOP-style
 * message (WhatsApp: whatsapp-provider.ts's `handleOptOut`; Voice: an
 * explicit CRM action) or a manual suppression.
 */
async function checkPhoneKeyedSuppression(organizationId: string, channel: DraftChannel, phone: string): Promise<SuppressionCheckResult> {
  const entry = await prisma.suppressionEntry.findUnique({ where: { organizationId_channel_phone: { organizationId, channel, phone } } });
  if (entry) return { suppressed: true, reason: entry.reason, detail: `Suppressed (${entry.reason}) via ${entry.source}.` };
  return { suppressed: false };
}

export interface AddSuppressionInput {
  organizationId: string;
  /** The real email (EMAIL channel) or E.164 phone number (WHATSAPP/VOICE channel) being suppressed. */
  identifier: string;
  channel?: DraftChannel;
  reason: SuppressionReason;
  source: string;
}

/** Idempotent (unique on [organizationId, channel, email|phone]) — safe to call repeatedly for the same real event. */
export async function addSuppressionEntry(input: AddSuppressionInput): Promise<void> {
  const channel = input.channel ?? "EMAIL";
  if (PHONE_KEYED_CHANNELS.has(channel)) {
    await prisma.suppressionEntry.upsert({
      where: { organizationId_channel_phone: { organizationId: input.organizationId, channel, phone: input.identifier } },
      create: { organizationId: input.organizationId, channel, phone: input.identifier, reason: input.reason, source: input.source },
      update: { reason: input.reason, source: input.source },
    });
    return;
  }
  const email = normalizeEmail(input.identifier);
  await prisma.suppressionEntry.upsert({
    where: { organizationId_channel_email: { organizationId: input.organizationId, channel: "EMAIL", email } },
    create: { organizationId: input.organizationId, channel: "EMAIL", email, reason: input.reason, source: input.source },
    update: { reason: input.reason, source: input.source },
  });
}
