import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getConnection } from "@/lib/integrations/connection-store";
import { validateTwilioSignature } from "@/lib/outreach/voice-provider";
import { logReplyCore } from "@/app/dashboard/outreach/_lib/reply-actions";
import type { CallStatus } from "@/generated/prisma/client";

/**
 * Phase 10 (AI Voice Sales Engine) — Twilio's real webhook for (a) call
 * status-callback events (queued → ringing → in-progress → completed/busy/
 * failed/no-answer/canceled) and (b) the recording/transcription callbacks
 * from the TwiML `<Record transcribe>` verb (see
 * src/app/api/voice/twiml/[callId]/route.ts). organizationId is taken from
 * the URL path (each org's Twilio number's callback points at this exact
 * per-org URL) so the correct org's Auth Token can be looked up BEFORE
 * trusting anything else in the request; the signature is then verified
 * against Twilio's real HMAC scheme — a payload that fails verification is
 * rejected outright (§12).
 *
 * Idempotency (§13/§17): rather than a separate event-log table, this
 * reuses the real Call row itself as the dedup key — a status update is
 * naturally idempotent (setting the same status twice is a no-op), and the
 * one operation that must never duplicate — creating the real transcript
 * Reply row — is explicitly guarded by `call.transcriptReplyId` already
 * being set.
 */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;

  const rawBody = await request.text();
  const parsed = new URLSearchParams(rawBody);
  const fields: Record<string, string> = {};
  for (const [key, value] of parsed.entries()) fields[key] = value;

  const connection = await getConnection(organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED" || !connection.accessToken) {
    console.error(`[webhooks/twilio-voice] no CONNECTED Twilio account for org ${organizationId} — rejecting.`);
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }
  let authToken: string;
  try {
    authToken = (JSON.parse(connection.accessToken) as { authToken?: string }).authToken ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid stored credential." }, { status: 500 });
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(authToken, request.url, fields, signature)) {
    console.error(`[webhooks/twilio-voice] signature verification failed for org ${organizationId} — rejecting.`);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const callSid = fields.CallSid;
  if (!callSid) return NextResponse.json({ ok: true }); // not a real call event we recognize

  const call = await prisma.call.findUnique({ where: { providerCallId: callSid } });
  if (!call || call.organizationId !== organizationId) return NextResponse.json({ ok: true });

  try {
    if (fields.CallStatus) {
      await handleStatusUpdate(call, fields);
    }
    if (fields.TranscriptionText && fields.TranscriptionStatus === "completed") {
      await handleTranscription(call, fields.TranscriptionText);
    } else if (fields.RecordingSid && fields.RecordingStatus) {
      await handleRecordingStatus(call.id, fields);
    }
  } catch (error) {
    console.error(`[webhooks/twilio-voice] processing failed for call ${call.id}:`, error);
    // Still 200 — Twilio retries on non-2xx and the real failure is already logged.
  }

  return NextResponse.json({ ok: true });
}

const TWILIO_STATUS_MAP: Record<string, CallStatus> = {
  queued: "CALL_REQUESTED",
  ringing: "RINGING",
  "in-progress": "ANSWERED",
  completed: "COMPLETED",
  busy: "BUSY",
  failed: "FAILED",
  "no-answer": "NO_ANSWER",
  canceled: "CANCELLED",
};

async function handleStatusUpdate(call: { id: string; organizationId: string }, fields: Record<string, string>): Promise<void> {
  const callId = call.id;
  const twilioStatus = fields.CallStatus;
  const mapped = TWILIO_STATUS_MAP[twilioStatus];
  if (!mapped) return;

  // Real, provider-confirmed answering-machine detection (§35) — a
  // machine-answered call is recorded as VOICEMAIL, never as a successful
  // human conversation, even though Twilio's own CallStatus still says
  // "in-progress"/"completed".
  const answeredBy = fields.AnsweredBy;
  const isVoicemail = typeof answeredBy === "string" && answeredBy.startsWith("machine");
  const status: CallStatus = isVoicemail && (mapped === "ANSWERED" || mapped === "COMPLETED") ? "VOICEMAIL" : mapped;

  const data: { status: CallStatus; answeredAt?: Date; endedAt?: Date; durationSeconds?: number; failedReason?: string; outcome?: "VOICEMAIL"; outcomeSetBy?: "PROVIDER_STATUS" } = { status };
  if (status === "ANSWERED" && !data.answeredAt) data.answeredAt = new Date();
  if (["COMPLETED", "BUSY", "FAILED", "NO_ANSWER", "CANCELLED", "VOICEMAIL"].includes(status)) {
    data.endedAt = new Date();
    if (fields.CallDuration) data.durationSeconds = Number(fields.CallDuration) || undefined;
  }
  if (status === "FAILED") data.failedReason = `Twilio reported call status "${twilioStatus}".`;
  if (status === "VOICEMAIL") {
    data.outcome = "VOICEMAIL";
    data.outcomeSetBy = "PROVIDER_STATUS";
  }

  await prisma.call.update({ where: { id: callId }, data });
  await logActivity({ organizationId: call.organizationId, type: "SYSTEM_EVENT", description: `Voice call status: ${status}.`, metadata: { callId, providerStatus: twilioStatus, answeredBy: answeredBy ?? null } });
}

async function handleRecordingStatus(callId: string, fields: Record<string, string>): Promise<void> {
  if (fields.RecordingStatus !== "completed") return;
  await prisma.call.update({ where: { id: callId }, data: { recordingProviderRef: fields.RecordingSid } });
}

async function handleTranscription(call: { id: string; organizationId: string; contactId: string; transcriptReplyId: string | null }, transcriptionText: string): Promise<void> {
  // Idempotency guard (§13/§17) — a real transcript is created at most once per call.
  if (call.transcriptReplyId) return;
  if (!transcriptionText.trim()) {
    await prisma.call.update({ where: { id: call.id }, data: { transcriptStatus: "TRANSCRIPT_FAILED" } });
    return;
  }

  const owner = await prisma.membership.findFirst({ where: { organizationId: call.organizationId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, orderBy: { createdAt: "asc" } });
  if (!owner) {
    console.warn(`[webhooks/twilio-voice] no OWNER/ADMIN membership for org ${call.organizationId} — cannot log the real transcript (logReplyCore needs a real actor).`);
    await prisma.call.update({ where: { id: call.id }, data: { transcriptStatus: "TRANSCRIPT_FAILED" } });
    return;
  }

  // Real Twilio transcript text, verbatim — never AI-generated, never
  // reconstructed from call metadata (§17 absolute rule). Reuses the exact
  // same real reply-logging pipeline every other channel goes through —
  // channel: VOICE — which also triggers Phase 6 Conversation Intelligence
  // automatically (§18/§37), never a parallel AI intelligence system.
  const result = await logReplyCore(call.organizationId, owner.userId, call.contactId, transcriptionText, "VOICE");
  if (result.ok && result.replyId) {
    await prisma.call.update({ where: { id: call.id }, data: { transcriptStatus: "TRANSCRIPT_AVAILABLE", transcriptReplyId: result.replyId } });
  } else {
    await prisma.call.update({ where: { id: call.id }, data: { transcriptStatus: "TRANSCRIPT_FAILED" } });
  }
}
