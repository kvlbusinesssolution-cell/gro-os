import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getConnection } from "@/lib/integrations/connection-store";
import { validateTwilioSignature, handleOptOut } from "@/lib/outreach/whatsapp-provider";
import { getOrCreateWhatsAppConversation, markConversationInbound } from "@/lib/outreach/whatsapp-conversation";
import { logReplyCore } from "@/app/dashboard/outreach/_lib/reply-actions";

/**
 * Phase 8 (WhatsApp Business Outreach) — Twilio's real webhook for both
 * (a) status-callback events on a message this app sent (queued → sent →
 * delivered → read/failed) and (b) inbound messages from a real contact.
 * The organizationId is taken from the URL path (each org configures its
 * OWN Twilio WhatsApp sender's webhook to this exact per-org URL — see
 * whatsapp-settings-actions.ts) so the correct org's Auth Token can be
 * looked up BEFORE trusting anything else in the request; the signature is
 * then verified against Twilio's real HMAC scheme (§12/§33) — a payload
 * that fails verification is rejected outright, never processed.
 *
 * Twilio POSTs `application/x-www-form-urlencoded`, not JSON.
 */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;

  const rawBody = await request.text();
  const parsed = new URLSearchParams(rawBody);
  const fields: Record<string, string> = {};
  for (const [key, value] of parsed.entries()) fields[key] = value;

  const connection = await getConnection(organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED" || !connection.accessToken) {
    console.error(`[webhooks/twilio-whatsapp] no CONNECTED Twilio account for org ${organizationId} — rejecting.`);
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }
  let authToken: string;
  try {
    authToken = (JSON.parse(connection.accessToken) as { authToken?: string }).authToken ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid stored credential." }, { status: 500 });
  }

  const signature = request.headers.get("x-twilio-signature");
  const valid = validateTwilioSignature(authToken, request.url, fields, signature);
  if (!valid) {
    console.error(`[webhooks/twilio-whatsapp] signature verification failed for org ${organizationId} — rejecting.`);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const messageSid = fields.MessageSid || fields.SmsSid;
  const messageStatus = fields.MessageStatus; // present on a status-callback event
  const inboundBody = fields.Body; // present on an inbound message

  try {
    if (messageStatus) {
      await handleStatusCallback(organizationId, messageSid, messageStatus, fields);
    } else if (typeof inboundBody === "string" && fields.From) {
      await handleInboundMessage(organizationId, fields.From, inboundBody, messageSid);
    }
  } catch (error) {
    console.error(`[webhooks/twilio-whatsapp] processing failed for org ${organizationId}:`, error);
    // Still 200 — Twilio retries on non-2xx and the real failure is already logged.
  }

  return NextResponse.json({ ok: true });
}

async function alreadyProcessed(organizationId: string, providerEventId: string): Promise<boolean> {
  const existing = await prisma.emailProviderEvent.findUnique({ where: { providerEventId } });
  return existing !== null && existing.organizationId === organizationId;
}

async function recordEvent(organizationId: string, emailDraftId: string | null, eventType: "SENT" | "DELIVERED" | "READ" | "FAILED", recipient: string, providerEventId: string, metadata: Record<string, string>) {
  await prisma.emailProviderEvent
    .create({ data: { organizationId, emailDraftId, provider: "TWILIO_WHATSAPP", eventType, recipient, providerEventId, metadata } })
    .catch(() => {}); // race with a duplicate delivery of the same event — the unique constraint already protects correctness
}

async function handleStatusCallback(organizationId: string, messageSid: string | undefined, status: string, fields: Record<string, string>): Promise<void> {
  if (!messageSid) return;
  const providerEventId = `${messageSid}:${status}`;
  if (await alreadyProcessed(organizationId, providerEventId)) return;

  const draft = await prisma.emailDraft.findUnique({ where: { providerMessageId: messageSid } });
  if (!draft || draft.organizationId !== organizationId) return;

  const recipient = fields.To?.replace(/^whatsapp:/, "") ?? "";

  switch (status) {
    case "delivered":
      await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      await recordEvent(organizationId, draft.id, "DELIVERED", recipient, providerEventId, fields);
      break;
    case "read":
      await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "READ", readAt: new Date() } });
      await recordEvent(organizationId, draft.id, "READ", recipient, providerEventId, fields);
      break;
    case "failed":
    case "undelivered": {
      const failedReason = fields.ErrorMessage || (fields.ErrorCode ? `Twilio error code ${fields.ErrorCode}` : "WhatsApp message failed to deliver.");
      await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedAt: new Date(), failedReason } });
      await recordEvent(organizationId, draft.id, "FAILED", recipient, providerEventId, fields);
      break;
    }
    default:
      // queued/sending/sent — already reflected by our own SENT transition at send time; no real new state to record.
      return;
  }

  await logActivity({
    organizationId,
    type: "SYSTEM_EVENT",
    description: `WhatsApp message ${status} (Twilio ${messageSid}).`,
    metadata: { emailDraftId: draft.id, provider: "TWILIO_WHATSAPP", messageSid, status },
  });
}

async function handleInboundMessage(organizationId: string, fromField: string, body: string, messageSid: string | undefined): Promise<void> {
  const phone = fromField.replace(/^whatsapp:/, "");
  const providerEventId = messageSid ? `${messageSid}:inbound` : `inbound:${phone}:${Date.now()}`;
  if (await alreadyProcessed(organizationId, providerEventId)) return;

  const contact = await prisma.contact.findFirst({ where: { organizationId, phone } });
  if (!contact) {
    console.warn(`[webhooks/twilio-whatsapp] inbound message from unknown number ${phone} for org ${organizationId} — no matching Contact, ignoring.`);
    return;
  }

  await recordEvent(organizationId, null, "SENT" /* inbound has no closer real EmailProviderEventType — logged for idempotency/audit, not shown as an outbound-send event */, phone, providerEventId, { Body: body, MessageSid: messageSid ?? "" });

  // §7 opt-out — a real, clear opt-out phrase is handled BEFORE logging a
  // normal reply, so an opted-out contact's message still gets recorded as
  // real evidence but never re-triggers outreach eligibility.
  const normalized = body.trim().toUpperCase();
  if (["STOP", "UNSUBSCRIBE", "DO NOT CONTACT", "OPT OUT", "OPTOUT"].includes(normalized)) {
    await handleOptOut(organizationId, phone, messageSid ?? null);
  }

  const conversation = await getOrCreateWhatsAppConversation(organizationId, contact.id);
  await markConversationInbound(conversation.id);

  const owner = await prisma.membership.findFirst({ where: { organizationId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, orderBy: { createdAt: "asc" } });
  if (!owner) {
    console.warn(`[webhooks/twilio-whatsapp] no OWNER/ADMIN membership for org ${organizationId} — cannot log reply (logReplyCore needs a real actor).`);
    return;
  }

  // Reuses the exact same real reply-logging pipeline email already goes
  // through (sentiment/intent classification, Phase 2 intent recompute,
  // Phase 6 conversation-intelligence trigger, notification, audit) — §22:
  // never a second, WhatsApp-specific analysis system.
  await logReplyCore(organizationId, owner.userId, contact.id, body, "WHATSAPP");
}
