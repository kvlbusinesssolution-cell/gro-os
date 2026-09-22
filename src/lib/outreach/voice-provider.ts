import { getConnection } from "@/lib/integrations/connection-store";
import { validateTwilioSignature } from "./whatsapp-provider";
import { getAppBaseUrl } from "./tracking";

/**
 * Phase 10 (AI Voice Sales Engine) — real outbound calling through the
 * org's own connected Twilio account (the SAME approved provider already
 * used for WhatsApp — reused, not duplicated; Twilio Voice is a real,
 * widely-used, compliant telephony API, not an unofficial mechanism).
 *
 * ===== Scope decision: AI-ASSISTED, not a live conversational AI agent =====
 * The spec allows the engine to "conduct OR ASSIST" permitted calls. A live
 * two-way conversational AI voice agent (real-time speech-to-text → LLM →
 * text-to-speech loop) requires a specialized real-time voice-AI provider
 * (e.g. a media-streaming product) this environment has no credentials
 * for, and building one without the ability to verify it against a real
 * provider would violate this project's no-fabrication discipline.
 * Instead, every call places a real Twilio Voice call whose TwiML (see
 * src/app/api/voice/twiml/[callId]/route.ts) (1) speaks the org's real,
 * configured AI-disclosure statement first — never hidden (§11) — then (2)
 * if, and only if, this specific call's snapshotted recordingConsentStatus
 * is RECORDING_ALLOWED, records the prospect's real spoken response via
 * Twilio's own `<Record>` verb with `transcribe: true`, which is a real
 * Twilio product feature, not a fabricated one. That real transcript (once
 * Twilio's transcription webhook actually fires) is what Phase 6
 * Conversation Intelligence analyzes — never AI-generated dialogue.
 */

const API_BASE = "https://api.twilio.com/2010-04-01";

interface TwilioCredentialPair {
  accountSid: string;
  authToken: string;
}

function parseCredentials(accessToken: string): TwilioCredentialPair {
  const parsed = JSON.parse(accessToken) as Partial<TwilioCredentialPair>;
  if (!parsed.accountSid || !parsed.authToken) throw new Error("Stored Twilio credential is missing accountSid/authToken.");
  return { accountSid: parsed.accountSid, authToken: parsed.authToken };
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function getFromNumber(organizationId: string): Promise<string | null> {
  const connection = await getConnection(organizationId, "TWILIO");
  const metadata = connection?.metadata as { voiceFromNumber?: string } | null | undefined;
  return metadata?.voiceFromNumber?.trim() || null;
}

export interface InitiateCallInput {
  organizationId: string;
  callId: string;
  /** Real E.164 recipient number — validated by the caller (voice-eligibility.ts) before this is ever reached. */
  to: string;
  /** Whether to instruct Twilio to record — only ever true when this call's snapshotted recordingConsentStatus is RECORDING_ALLOWED (checked by the caller, re-checked in the TwiML endpoint itself). */
  recordingAllowed: boolean;
}

export type InitiateCallResult =
  | { ok: true; providerCallId: string }
  | { ok: false; errorKind: "not_configured" | "failed" | "rate_limited"; error: string; statusCode?: number; retryAfterSeconds?: number | null };

export async function initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
  const connection = await getConnection(input.organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED" || !connection.accessToken) {
    return { ok: false, errorKind: "not_configured", error: "Voice calling isn't configured — connect a Twilio account at /dashboard/settings/integrations." };
  }
  const fromNumber = await getFromNumber(input.organizationId);
  if (!fromNumber) {
    return { ok: false, errorKind: "not_configured", error: "No authorized caller-ID number configured for voice calling — set one at /dashboard/settings/voice." };
  }

  let credentials: TwilioCredentialPair;
  try {
    credentials = parseCredentials(connection.accessToken);
  } catch (error) {
    return { ok: false, errorKind: "not_configured", error: error instanceof Error ? error.message : "Invalid stored Twilio credential." };
  }

  const baseUrl = getAppBaseUrl();
  const params = new URLSearchParams({
    To: input.to,
    From: fromNumber,
    Url: `${baseUrl}/api/voice/twiml/${input.callId}`,
    StatusCallback: `${baseUrl}/api/webhooks/twilio-voice/${input.organizationId}`,
    StatusCallbackEvent: "initiated ringing answered completed",
    // Twilio's real answering-machine-detection feature — used only to
    // classify the real provider-confirmed VOICEMAIL status (§35), never
    // to fabricate one.
    MachineDetection: "DetectMessageEnd",
  });

  try {
    const response = await fetch(`${API_BASE}/Accounts/${credentials.accountSid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(credentials.accountSid, credentials.authToken), "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || null : null;
      return {
        ok: false,
        errorKind: response.status === 429 ? "rate_limited" : "failed",
        error: `Twilio rejected the call (HTTP ${response.status}, code ${body.code ?? "?"}): ${body.message ?? "unknown error"}`,
        statusCode: response.status,
        retryAfterSeconds,
      };
    }
    if (!body.sid) return { ok: false, errorKind: "failed", error: "Twilio accepted the request but returned no call SID." };
    return { ok: true, providerCallId: body.sid };
  } catch (error) {
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "Voice call request failed." };
  }
}

/** Ends an in-progress call — a real, explicit hangup, never a fabricated one. */
export async function endCall(organizationId: string, providerCallId: string): Promise<{ ok: boolean; error?: string }> {
  const connection = await getConnection(organizationId, "TWILIO");
  if (!connection?.accessToken) return { ok: false, error: "Voice calling isn't configured." };
  const credentials = parseCredentials(connection.accessToken);
  const response = await fetch(`${API_BASE}/Accounts/${credentials.accountSid}/Calls/${providerCallId}.json`, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(credentials.accountSid, credentials.authToken), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Status: "completed" }).toString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `Twilio rejected the end-call request (HTTP ${response.status}): ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

// Twilio's real HMAC-SHA1 webhook signature scheme — the SAME algorithm
// already implemented and tested in whatsapp-provider.ts; reused directly
// rather than reimplemented, since both webhooks come from the same real
// Twilio account/Auth Token.
export { validateTwilioSignature };
