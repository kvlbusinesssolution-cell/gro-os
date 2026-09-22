import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import { getConnection } from "@/lib/integrations/connection-store";
import { checkSuppression, addSuppressionEntry } from "./suppression";
import { getOrCreateWhatsAppSendingIdentity, checkWhatsAppRateLimit, recordWhatsAppSendAttempt, applyWhatsAppRateLimitCooldown } from "./whatsapp-sending-identity";
import { isValidE164 } from "./whatsapp-eligibility";

/**
 * Phase 8 (WhatsApp Business Outreach) — real outbound WhatsApp send,
 * through the org's own connected Twilio account (an approved Meta
 * WhatsApp Business Solution Provider — never an unofficial WhatsApp
 * Web/QR-session/scraping mechanism). Mirrors email-provider.ts's exact
 * structure: a real tri-state result (sent for real / genuinely failed /
 * not configured), suppression + rate-limit checks BEFORE any provider
 * call, never a fabricated success.
 *
 * Credentials are read from the existing, already-audited secure secrets
 * system (IntegrationConnection, AES-256-GCM at rest) — the real Twilio
 * Account SID + Auth Token an org connects at
 * /dashboard/settings/integrations, exactly the same credential the
 * existing SMS workflow node already uses (communication.ts). The org's
 * WhatsApp-enabled sender number is stored as non-secret
 * IntegrationConnection.metadata.whatsappFromNumber (set via
 * whatsapp-settings-actions.ts) — never hard-coded.
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

function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${e164}`;
}

export interface WhatsAppSendInput {
  organizationId: string;
  /** Real E.164 recipient number — validated by the caller (whatsapp-eligibility.ts) before this is ever reached. */
  to: string;
  /** Free-form session-window body text. Mutually exclusive with templateContentSid — a template send never also carries a free-form body per WhatsApp's own rules. */
  body?: string;
  /** Twilio Content API ContentSid for an approved template — required to message a recipient outside an open 24-hour session window. */
  templateContentSid?: string;
  templateVariables?: Record<string, string>;
  statusCallbackUrl?: string;
}

export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      errorKind: "not_configured" | "failed" | "suppressed" | "rate_limited" | "invalid_number" | "duplicate";
      error: string;
      statusCode?: number;
      retryAfterSeconds?: number | null;
    };

const DUPLICATE_WINDOW_MS = 5 * 60_000;

async function getFromNumber(organizationId: string): Promise<string | null> {
  const connection = await getConnection(organizationId, "TWILIO");
  const metadata = connection?.metadata as { whatsappFromNumber?: string } | null | undefined;
  return metadata?.whatsappFromNumber?.trim() || null;
}

/**
 * Sends a real WhatsApp message. Returns `not_configured` honestly when no
 * Twilio account is connected or no WhatsApp sender number is set — never
 * marks a message SENT for nothing (same discipline as sendOutreachEmail).
 */
export async function sendWhatsAppMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
  if (!isValidE164(input.to)) {
    return { ok: false, errorKind: "invalid_number", error: `"${input.to}" is not a valid E.164 phone number.` };
  }

  const suppression = await checkSuppression(input.organizationId, input.to, "WHATSAPP");
  if (suppression.suppressed) {
    return { ok: false, errorKind: "suppressed", error: suppression.detail ?? `Recipient is suppressed (${suppression.reason}).` };
  }

  // §17/§30 duplicate-recipient protection — same window/discipline as email.
  const recentDuplicate = await prisma.emailDraft.findFirst({
    where: { organizationId: input.organizationId, channel: "WHATSAPP", status: "SENT", sentAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }, contact: { phone: input.to } },
    orderBy: { sentAt: "desc" },
  });
  if (recentDuplicate) {
    return { ok: false, errorKind: "duplicate", error: `Duplicate send blocked — a WhatsApp message was already sent to ${input.to} ${Math.round((Date.now() - (recentDuplicate.sentAt?.getTime() ?? 0)) / 1000)}s ago.` };
  }

  const connection = await getConnection(input.organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED" || !connection.accessToken) {
    return { ok: false, errorKind: "not_configured", error: "WhatsApp sending isn't configured — connect a Twilio account at /dashboard/settings/integrations." };
  }
  const fromNumber = await getFromNumber(input.organizationId);
  if (!fromNumber) {
    return { ok: false, errorKind: "not_configured", error: "No WhatsApp sender number configured — set one at /dashboard/settings/whatsapp." };
  }

  const identity = await getOrCreateWhatsAppSendingIdentity(input.organizationId, fromNumber);
  const rateLimit = await checkWhatsAppRateLimit(identity);
  if (!rateLimit.allowed) {
    return { ok: false, errorKind: "rate_limited", error: rateLimit.reason ?? "WhatsApp sender is currently rate-limited." };
  }

  let credentials: TwilioCredentialPair;
  try {
    credentials = parseCredentials(connection.accessToken);
  } catch (error) {
    return { ok: false, errorKind: "not_configured", error: error instanceof Error ? error.message : "Invalid stored Twilio credential." };
  }

  const params = new URLSearchParams({ To: toWhatsAppAddress(input.to), From: toWhatsAppAddress(fromNumber) });
  if (input.templateContentSid) {
    params.set("ContentSid", input.templateContentSid);
    if (input.templateVariables) params.set("ContentVariables", JSON.stringify(input.templateVariables));
  } else if (input.body) {
    params.set("Body", input.body);
  } else {
    return { ok: false, errorKind: "failed", error: "A WhatsApp send needs either a free-form body or an approved templateContentSid." };
  }
  if (input.statusCallbackUrl) params.set("StatusCallback", input.statusCallbackUrl);

  try {
    const response = await fetch(`${API_BASE}/Accounts/${credentials.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(credentials.accountSid, credentials.authToken), "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const responseBody = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || null : null;
      const result: WhatsAppSendResult = {
        ok: false,
        errorKind: response.status === 429 ? "rate_limited" : "failed",
        error: `Twilio rejected the WhatsApp send (HTTP ${response.status}, code ${responseBody.code ?? "?"}): ${responseBody.message ?? "unknown error"}`,
        statusCode: response.status,
        retryAfterSeconds,
      };
      await recordWhatsAppSendAttempt(identity.id, "failed");
      if (response.status === 429) await applyWhatsAppRateLimitCooldown(identity.id, retryAfterSeconds);
      return result;
    }

    await recordWhatsAppSendAttempt(identity.id, "sent");
    return { ok: true, providerMessageId: responseBody.sid ?? crypto.randomUUID() };
  } catch (error) {
    await recordWhatsAppSendAttempt(identity.id, "failed");
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "WhatsApp send request failed." };
  }
}

/** §7 opt-out handling — reuses the real suppression system (WHATSAPP channel), never a second mechanism. */
export async function handleOptOut(organizationId: string, phone: string, sourceMessageProviderId: string | null): Promise<void> {
  await addSuppressionEntry({
    organizationId,
    identifier: phone,
    channel: "WHATSAPP",
    reason: "UNSUBSCRIBED",
    source: sourceMessageProviderId ? `Inbound WhatsApp opt-out message (provider id ${sourceMessageProviderId})` : "Inbound WhatsApp opt-out message",
  });
}

/**
 * §33 webhook signature validation — Twilio's real HMAC-SHA1 scheme: the
 * full request URL plus every POST param (sorted by key, key+value
 * concatenated with no separator) is HMAC-signed with the account's Auth
 * Token, base64-encoded, and sent as the `X-Twilio-Signature` header. A
 * payload that doesn't verify is never trusted (§12: "do not trust
 * arbitrary webhook payloads without validation").
 */
export function validateTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], fullUrl);
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false; // length mismatch etc — never throw on a malformed header, just fail closed
  }
}
