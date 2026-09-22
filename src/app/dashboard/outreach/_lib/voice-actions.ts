"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkVoiceEligibility, type VoiceEligibilityResult } from "@/lib/outreach/voice-eligibility";
import { initiateVoiceCallCore, updateCallOutcome, type InitiateVoiceCallResult } from "@/lib/outreach/voice-call";
import type { Call, CallOutcome, VoiceConsent, VoiceConsentStatus, VoiceRecordingConsent } from "@/generated/prisma/client";

export interface VoiceActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function requireActiveMembership() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  return { ok: true as const, userId, organizationId: membership.organizationId };
}

/** Read-time eligibility check — for showing real status in the UI before offering a call. */
export async function getVoiceEligibilityAction(contactId: string): Promise<VoiceActionResult<VoiceEligibilityResult>> {
  const access = await requireActiveMembership();
  if (!access.ok) return { ok: false, error: access.error };
  const data = await checkVoiceEligibility(access.organizationId, contactId);
  return { ok: true, data };
}

/** §5/§6 — the only entry point that places a real call; performs a fresh eligibility check immediately before dialing. */
export async function placeVoiceCallAction(contactId: string, campaignId?: string): Promise<VoiceActionResult<InitiateVoiceCallResult>> {
  const access = await requireActiveMembership();
  if (!access.ok) return { ok: false, error: access.error };

  if (!checkRateLimit(`voice-call:${access.userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many call requests — wait a few minutes and try again." };
  }

  const data = await initiateVoiceCallCore(access.organizationId, contactId, access.userId, campaignId);
  revalidatePath(`/dashboard/outreach/inbox/${contactId}`);
  revalidatePath(`/dashboard/companies`);
  return { ok: true, data };
}

/** §14 — human-selected outcome only; never silently AI-decided. */
export async function updateCallOutcomeAction(callId: string, outcome: CallOutcome): Promise<VoiceActionResult> {
  const access = await requireActiveMembership();
  if (!access.ok) return { ok: false, error: access.error };
  const result = await updateCallOutcome(access.organizationId, callId, outcome, access.userId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/dashboard/outreach`);
  return { ok: true };
}

export interface CaptureVoiceConsentInput {
  contactId: string;
  status: VoiceConsentStatus;
  recordingConsent: VoiceRecordingConsent;
  source: string;
  evidence: string;
  jurisdiction?: string;
  purpose?: string;
}

/**
 * §8/§9 — the ONLY way a real, positive VoiceConsent row is ever created.
 * `source`/`evidence` are required and must describe a genuine event (a
 * signed clause, a verbal confirmation with a real reference, an opt-in
 * form submission) — never a guess. This is a deliberate, explicit human
 * action; nothing in this codebase infers consent automatically.
 */
export async function captureVoiceConsentAction(input: CaptureVoiceConsentInput): Promise<VoiceActionResult<VoiceConsent>> {
  const access = await requireActiveMembership();
  if (!access.ok) return { ok: false, error: access.error };
  if (!input.source.trim() || !input.evidence.trim()) return { ok: false, error: "A real source and evidence are required to record consent." };

  const contact = await prisma.contact.findUnique({ where: { id: input.contactId } });
  if (!contact || contact.organizationId !== access.organizationId) return { ok: false, error: "Contact not found." };

  const data = await prisma.voiceConsent.upsert({
    where: { contactId: input.contactId },
    create: {
      organizationId: access.organizationId,
      contactId: input.contactId,
      status: input.status,
      recordingConsent: input.recordingConsent,
      source: input.source.trim(),
      evidence: input.evidence.trim(),
      jurisdiction: input.jurisdiction?.trim() || null,
      purpose: input.purpose?.trim() || null,
      capturedAt: new Date(),
      capturedByUserId: access.userId,
    },
    update: {
      status: input.status,
      recordingConsent: input.recordingConsent,
      source: input.source.trim(),
      evidence: input.evidence.trim(),
      jurisdiction: input.jurisdiction?.trim() || null,
      purpose: input.purpose?.trim() || null,
      capturedAt: new Date(),
      capturedByUserId: access.userId,
    },
  });

  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "voice.consent_captured", metadata: { contactId: input.contactId, status: input.status, recordingConsent: input.recordingConsent } });
  revalidatePath(`/dashboard/outreach/inbox/${input.contactId}`);
  return { ok: true, data };
}

/** Real call history for a contact — every field comes straight from the persisted Call row. */
export async function listCallsForContactAction(contactId: string): Promise<VoiceActionResult<Call[]>> {
  const access = await requireActiveMembership();
  if (!access.ok) return { ok: false, error: access.error };
  const data = await prisma.call.findMany({ where: { organizationId: access.organizationId, contactId }, orderBy: { createdAt: "desc" } });
  return { ok: true, data };
}
