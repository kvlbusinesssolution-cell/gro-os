import { prisma } from "@/lib/prisma";
import { checkSuppression } from "./suppression";
import { isValidE164 } from "./whatsapp-eligibility";
import type { CallEligibilityStatus, VoiceConsentStatus, VoiceRecordingConsent } from "@/generated/prisma/client";

/**
 * Phase 10 (AI Voice Sales Engine) §6/§8 — the single, mandatory eligibility
 * check every outbound call MUST pass immediately before dialing (never
 * cached from an earlier check — §32: a scheduled call re-checks this
 * fresh). This is the most conservative gate in this codebase: unlike
 * Email/WhatsApp/LinkedIn (eligible unless explicitly opted out), voice
 * defaults to NOT eligible unless a real, positive VoiceConsent.status ===
 * "GRANTED" row exists — a phone number, website, email, LinkedIn profile,
 * job title, or company size is explicitly NEVER treated as consent (§8).
 */

export interface VoiceEligibilityResult {
  status: CallEligibilityStatus;
  phone: string | null;
  consentStatus: VoiceConsentStatus;
  recordingConsent: VoiceRecordingConsent;
  detail: string;
}

// This app has no real jurisdiction/time-zone rule engine and no per-country
// telemarketing-hours database — Contact.country/Company.headquartersCountry
// are the only real signals available. Rather than invent a per-country
// rules table this codebase has no authoritative source for, the ONE
// conservative rule enforced here is a single global calling window in the
// ORG's own local server time (9am–7pm) — documented as an approximation,
// not a substitute for real jurisdiction-specific legal review. If the
// contact's country is unknown, this still applies (never skipped) since
// a wider default would be less safe, not more.
const ALLOWED_CALL_HOUR_START = 9;
const ALLOWED_CALL_HOUR_END = 19;

function isWithinAllowedCallWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= ALLOWED_CALL_HOUR_START && hour < ALLOWED_CALL_HOUR_END;
}

export async function checkVoiceEligibility(organizationId: string, contactId: string, now: Date = new Date()): Promise<VoiceEligibilityResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) {
    return { status: "UNKNOWN", phone: null, consentStatus: "UNKNOWN", recordingConsent: "UNKNOWN", detail: "Contact not found." };
  }

  if (!contact.phone || !isValidE164(contact.phone)) {
    return { status: "INVALID_NUMBER", phone: contact.phone, consentStatus: "UNKNOWN", recordingConsent: "UNKNOWN", detail: "No valid E.164 phone number on file." };
  }
  const phone = contact.phone;

  // §7 — explicit VOICE-channel opt-out always blocks, checked before
  // (and independent of) consent status.
  const suppression = await checkSuppression(organizationId, phone, "VOICE");
  if (suppression.suppressed) {
    return { status: suppression.reason === "UNSUBSCRIBED" ? "OPTED_OUT" : "DO_NOT_CALL", phone, consentStatus: "UNKNOWN", recordingConsent: "UNKNOWN", detail: suppression.detail ?? `Suppressed (${suppression.reason}).` };
  }

  const consent = await prisma.voiceConsent.findUnique({ where: { contactId } });
  const consentStatus = consent?.status ?? "UNKNOWN";
  const recordingConsent = consent?.recordingConsent ?? "UNKNOWN";

  if (consentStatus === "DENIED") {
    return { status: "DO_NOT_CALL", phone, consentStatus, recordingConsent, detail: "Contact has explicitly denied voice-call consent." };
  }
  if (consentStatus !== "GRANTED") {
    return { status: "CONSENT_REQUIRED", phone, consentStatus, recordingConsent, detail: "No real, positive voice-call consent on file — a phone number alone is never treated as consent (§8)." };
  }

  if (!isWithinAllowedCallWindow(now)) {
    return { status: "OUTSIDE_ALLOWED_TIME", phone, consentStatus, recordingConsent, detail: `Outside the configured allowed calling window (${ALLOWED_CALL_HOUR_START}:00–${ALLOWED_CALL_HOUR_END}:00, org local time).` };
  }

  return { status: "ELIGIBLE", phone, consentStatus, recordingConsent, detail: "Valid number, real consent on file, not suppressed, within the allowed calling window." };
}
