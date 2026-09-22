import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getConnection } from "@/lib/integrations/connection-store";
import { validateTwilioSignature } from "@/lib/outreach/voice-provider";
import { getAppBaseUrl } from "@/lib/outreach/tracking";

const DEFAULT_AI_DISCLOSURE = "This call uses AI-assisted technology from KVL Business Solutions and may be recorded. Please stay on the line to speak with our team.";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Phase 10 (AI Voice Sales Engine) §11 — the TwiML Twilio fetches the
 * instant a real call connects. ALWAYS speaks the real, org-configured (or
 * safe default) AI-disclosure statement FIRST, before anything else — this
 * app never hides the automated nature of a call where disclosure applies
 * (§11), and never impersonates a human.
 *
 * Recording (via Twilio's real `<Record>` verb with `transcribe: true`)
 * only happens when this specific call's snapshotted
 * recordingConsentStatus is RECORDING_ALLOWED — re-checked here
 * independently of whatever was passed to initiateCall, since this
 * endpoint is the actual source of truth Twilio executes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call) return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', { status: 200, headers: { "Content-Type": "text/xml" } });

  const connection = await getConnection(call.organizationId, "TWILIO");
  if (connection?.accessToken) {
    const rawBody = await request.clone().text();
    const parsed = new URLSearchParams(rawBody);
    const fields: Record<string, string> = {};
    for (const [key, value] of parsed.entries()) fields[key] = value;
    const authToken = (JSON.parse(connection.accessToken) as { authToken?: string }).authToken ?? "";
    const signature = request.headers.get("x-twilio-signature");
    if (!validateTwilioSignature(authToken, request.url, fields, signature)) {
      console.error(`[voice-twiml] signature verification failed for call ${callId} — rejecting.`);
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', { status: 200, headers: { "Content-Type": "text/xml" } });
    }
  }

  const metadata = connection?.metadata as { aiDisclosureScript?: string } | null | undefined;
  const disclosure = metadata?.aiDisclosureScript?.trim() || DEFAULT_AI_DISCLOSURE;

  await prisma.call.update({ where: { id: callId }, data: { aiDisclosureGiven: true } });

  const baseUrl = getAppBaseUrl();
  const sayBlock = `<Say voice="Polly.Joanna">${escapeXml(disclosure)}</Say>`;

  const recordingAllowed = call.recordingConsentStatus === "RECORDING_ALLOWED";
  const body = recordingAllowed
    ? `${sayBlock}<Record maxLength="120" playBeep="true" transcribe="true" transcribeCallback="${baseUrl}/api/webhooks/twilio-voice/${call.organizationId}" recordingStatusCallback="${baseUrl}/api/webhooks/twilio-voice/${call.organizationId}" /><Say voice="Polly.Joanna">Thank you. Goodbye.</Say>`
    : `${sayBlock}<Say voice="Polly.Joanna">A member of our team will follow up with you shortly. Thank you.</Say>`;

  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
}
