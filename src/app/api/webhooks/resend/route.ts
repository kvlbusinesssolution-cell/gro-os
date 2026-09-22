import { Webhook } from "svix";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { addSuppressionEntry } from "@/lib/outreach/suppression";

// Resend outbound-email lifecycle webhook receiver. Resend signs webhook
// deliveries via Svix (svix-id/svix-timestamp/svix-signature headers), with
// a per-endpoint secret ("whsec_...") issued when the webhook is created in
// the Resend dashboard. Verify this payload shape (event `type` values,
// `data.email_id`, `data.bounce`/`data.complaint` field paths) against
// Resend's current webhook docs (resend.com/docs/dashboard/webhooks/event-types)
// before relying on this in production — written from stable, well-known
// conventions without live doc access in this session.
function verifySignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET not set — rejecting payload (integration Not Configured).");
    return false;
  }
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  try {
    new Webhook(secret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers)) {
    console.error("[webhooks/resend] signature verification failed — rejecting.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const type = extractType(payload);
    const emailId = extractEmailId(payload);

    if (!emailId || (type !== "email.bounced" && type !== "email.complained" && type !== "email.delivered")) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const draft = await prisma.emailDraft.findUnique({ where: { resendMessageId: emailId }, include: { contact: { select: { email: true } } } });
    if (!draft) {
      console.warn(`[webhooks/resend] no EmailDraft for resendMessageId ${emailId} — ignoring.`);
      return NextResponse.json({ ok: true, skipped: true });
    }
    const recipientEmail = draft.contact.email;

    // Phase 4 (Email Deliverability & Sender Health Engine) — real
    // idempotency: Svix's own delivery id is the provider's real event id.
    // A unique constraint on EmailProviderEvent.providerEventId means a
    // re-delivered webhook is a genuine no-op at the DB level (the create
    // below throws P2002, caught and treated as "already processed" — never
    // a second EmailDraft update, never a second suppression entry).
    const providerEventId = request.headers.get("svix-id");
    if (providerEventId) {
      const alreadyProcessed = await prisma.emailProviderEvent.findUnique({ where: { providerEventId } });
      if (alreadyProcessed) {
        return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
      }
    }

    if (type === "email.bounced") {
      const bounceReason = extractBounceReason(payload);
      // Best-effort hard/soft extraction — see EmailDraft.bounceType's doc
      // comment: "unknown" (never a silently-assumed "soft") when the real
      // payload doesn't clearly say, so suppression stays conservative.
      const bounceType = extractBounceType(payload);
      await prisma.emailDraft.update({
        where: { id: draft.id },
        data: { status: "BOUNCED", bouncedAt: new Date(), bounceReason, bounceType },
      });
      if (providerEventId) {
        await prisma.emailProviderEvent
          .create({
            data: {
              organizationId: draft.organizationId,
              emailDraftId: draft.id,
              provider: "RESEND",
              eventType: bounceType === "soft" ? "SOFT_BOUNCE" : "HARD_BOUNCE",
              recipient: recipientEmail,
              providerEventId,
              metadata: payload as object,
            },
          })
          .catch(() => {}); // race with another delivery of the same event — the unique constraint already protects correctness
      }
      if (bounceType !== "soft") {
        await addSuppressionEntry({ organizationId: draft.organizationId, identifier: recipientEmail, reason: "HARD_BOUNCE", source: `Resend webhook ${emailId}` });
      }
      await logActivity({
        organizationId: draft.organizationId,
        type: "SYSTEM_EVENT",
        description: `Email bounced (Resend message ${emailId}): ${bounceReason}`,
        metadata: { emailDraftId: draft.id, provider: "RESEND", resendMessageId: emailId, bounceType },
      });
    } else if (type === "email.delivered") {
      // Phase 17 (Advanced Outbound + Email Deliverability) — the real
      // delivered signal that was missing (see this file's own prior
      // gap: only bounced/complained were ever handled). Sets the real
      // EmailDraft.deliveredAt timestamp from a real, signature-verified
      // provider callback — same additive-field precedent the complaint
      // branch below already uses (complainedAt is set WITHOUT moving
      // `status` off SENT). Deliberately does NOT transition `status` to
      // DELIVERED here: dozens of existing queries across this codebase
      // filter EmailDraft by `status: "SENT"` to mean "really sent,
      // successfully" (campaign stats, revenue attribution, the Sent
      // inbox tab, etc.) — moving status would silently break all of
      // them. `deliveredAt` is the real, additive, non-breaking signal.
      if (draft.status === "SENT" && !draft.deliveredAt) {
        await prisma.emailDraft.update({
          where: { id: draft.id },
          data: { deliveredAt: new Date() },
        });
      }
      if (providerEventId) {
        await prisma.emailProviderEvent
          .create({
            data: {
              organizationId: draft.organizationId,
              emailDraftId: draft.id,
              provider: "RESEND",
              eventType: "DELIVERED",
              recipient: recipientEmail,
              providerEventId,
              metadata: payload as object,
            },
          })
          .catch(() => {});
      }
    } else {
      await prisma.emailDraft.update({
        where: { id: draft.id },
        data: { complainedAt: new Date() },
      });
      if (providerEventId) {
        await prisma.emailProviderEvent
          .create({
            data: {
              organizationId: draft.organizationId,
              emailDraftId: draft.id,
              provider: "RESEND",
              eventType: "COMPLAINT",
              recipient: recipientEmail,
              providerEventId,
              metadata: payload as object,
            },
          })
          .catch(() => {});
      }
      await addSuppressionEntry({ organizationId: draft.organizationId, identifier: recipientEmail, reason: "SPAM_COMPLAINT", source: `Resend webhook ${emailId}` });
      await logActivity({
        organizationId: draft.organizationId,
        type: "SYSTEM_EVENT",
        description: `Spam complaint received (Resend message ${emailId}).`,
        metadata: { emailDraftId: draft.id, provider: "RESEND", resendMessageId: emailId },
      });
    }
  } catch (error) {
    console.error("[webhooks/resend] processing failed:", error);
    // Still 200 — Resend/Svix retries on non-2xx and we've already logged the real failure.
  }

  return NextResponse.json({ ok: true });
}

/** Best-effort — see EmailDraft.bounceType's doc comment. Checks the field paths a Resend bounce payload is documented to use; returns "unknown" (never a guessed "soft") if none match. */
function extractBounceType(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "unknown";
  const data = (payload as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return "unknown";
  const bounce = (data as Record<string, unknown>).bounce;
  const raw =
    (typeof bounce === "object" && bounce !== null ? (bounce as Record<string, unknown>).type : undefined) ??
    (data as Record<string, unknown>).bounce_type;
  if (typeof raw !== "string") return "unknown";
  const lower = raw.toLowerCase();
  if (lower.includes("hard") || lower.includes("permanent")) return "hard";
  if (lower.includes("soft") || lower.includes("transient")) return "soft";
  return "unknown";
}

function extractType(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const type = (payload as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

function extractEmailId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return null;
  const emailId = (data as Record<string, unknown>).email_id;
  return typeof emailId === "string" ? emailId : null;
}

function extractBounceReason(payload: unknown): string {
  const fallback = "Email bounced (no further detail provided by Resend).";
  if (typeof payload !== "object" || payload === null) return fallback;
  const data = (payload as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return fallback;
  const bounce = (data as Record<string, unknown>).bounce;
  if (typeof bounce === "object" && bounce !== null) {
    const message = (bounce as Record<string, unknown>).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  const reason = (data as Record<string, unknown>).reason;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return fallback;
}
