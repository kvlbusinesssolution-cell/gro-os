import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkVoiceEligibility } from "./voice-eligibility";
import { initiateCall } from "./voice-provider";
import type { Call, CallOutcome } from "@/generated/prisma/client";

/**
 * Phase 10 (AI Voice Sales Engine) §5/§6/§32 — the single orchestration
 * entry point for placing a real outbound call. Every caller (a manual
 * "Call now" action, or a future scheduled-call job) MUST go through this
 * — it performs the fresh eligibility check immediately before dialing
 * (never a cached/earlier check) and creates the real Call row with a
 * snapshot of exactly what was true at that moment.
 */

export interface InitiateVoiceCallResult {
  ok: boolean;
  call: Call | null;
  error: string | null;
}

export async function initiateVoiceCallCore(organizationId: string, contactId: string, actingUserId: string | null, campaignId?: string): Promise<InitiateVoiceCallResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { ok: false, call: null, error: "Contact not found." };

  const eligibility = await checkVoiceEligibility(organizationId, contactId);

  await logAudit({ userId: actingUserId, organizationId, action: "voice.eligibility_checked", metadata: { contactId, status: eligibility.status } });

  if (eligibility.status !== "ELIGIBLE") {
    // §6: a blocked call is still recorded — real, auditable evidence of
    // why no call was placed — never silently dropped.
    const blocked = await prisma.call.create({
      data: {
        organizationId,
        companyId: contact.companyId,
        contactId,
        campaignId: campaignId ?? null,
        direction: "OUTBOUND",
        eligibilityStatus: eligibility.status,
        consentStatus: eligibility.consentStatus,
        recordingConsentStatus: eligibility.recordingConsent,
        status: "CANCELLED",
        cancelReason: `VOICE OUTREACH NOT ELIGIBLE — ${eligibility.status}: ${eligibility.detail}`,
      },
    });
    await logAudit({ userId: actingUserId, organizationId, action: "voice.call_blocked", metadata: { contactId, callId: blocked.id, status: eligibility.status } });
    return { ok: false, call: blocked, error: `VOICE OUTREACH NOT ELIGIBLE — ${eligibility.status}: ${eligibility.detail}` };
  }

  const call = await prisma.call.create({
    data: {
      organizationId,
      companyId: contact.companyId,
      contactId,
      campaignId: campaignId ?? null,
      direction: "OUTBOUND",
      eligibilityStatus: eligibility.status,
      consentStatus: eligibility.consentStatus,
      recordingConsentStatus: eligibility.recordingConsent,
      status: "CALL_REQUESTED",
    },
  });

  const result = await initiateCall({ organizationId, callId: call.id, to: eligibility.phone!, recordingAllowed: eligibility.recordingConsent === "RECORDING_ALLOWED" });

  if (!result.ok) {
    await prisma.call.update({ where: { id: call.id }, data: { status: "FAILED", failedReason: result.error } });
    await logAudit({ userId: actingUserId, organizationId, action: "voice.call_failed", metadata: { contactId, callId: call.id, error: result.error } });
    return { ok: false, call: await prisma.call.findUniqueOrThrow({ where: { id: call.id } }), error: result.error };
  }

  const updated = await prisma.call.update({ where: { id: call.id }, data: { providerCallId: result.providerCallId, startedAt: new Date() } });
  await logAudit({ userId: actingUserId, organizationId, action: "voice.call_started", metadata: { contactId, callId: call.id, providerCallId: result.providerCallId } });
  return { ok: true, call: updated, error: null };
}

export interface UpdateCallOutcomeResult {
  ok: boolean;
  error?: string;
}

/**
 * §14 — outcome is always explicitly attributed: HUMAN (this function, the
 * real path) or PROVIDER_STATUS (webhook-set VOICEMAIL/NO_ANSWER/BUSY,
 * never routed through here). An AI-suggested outcome is a
 * recommendation only (see voice-recommendation.ts) — it is never written
 * here as the final CRM outcome, matching §14's explicit rule.
 */
export async function updateCallOutcome(organizationId: string, callId: string, outcome: CallOutcome, actingUserId: string): Promise<UpdateCallOutcomeResult> {
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || call.organizationId !== organizationId) return { ok: false, error: "Call not found." };

  await prisma.call.update({ where: { id: callId }, data: { outcome, outcomeSetBy: "HUMAN" } });
  await logAudit({ userId: actingUserId, organizationId, action: "voice.outcome_updated", metadata: { callId, outcome } });
  return { ok: true };
}
