/**
 * Real outbound email for the Outreach Assistant — deliberately NOT built on
 * top of src/lib/email.ts's sendEmail(), because that function's contract is
 * fire-and-forget (never throws, never reports whether a real send actually
 * happened — it just logs and returns void when EMAIL_SERVER is unset). A
 * customer-facing cold email needs an honest tri-state: sent for real,
 * genuinely failed, or not configured — an EmailDraft must never be marked
 * SENT when nothing left the building.
 *
 * Four real providers, each only active when actually configured — same
 * "only register what's configured" convention as the OAuth providers in
 * src/auth.ts:
 *  1. Gmail (org has a CONNECTED GOOGLE_GMAIL integration) — a real fetch to
 *     the Gmail API, sending as the org's own connected mailbox.
 *  2. Outlook (org has a CONNECTED MICROSOFT_OUTLOOK integration) — a real
 *     fetch to Microsoft Graph, same idea.
 *  3. Resend (RESEND_API_KEY) — a real fetch to the Resend REST API.
 *  4. SMTP (EMAIL_SERVER) — a real nodemailer transport, same connection
 *     string convention as sendEmail()'s existing EMAIL_SERVER contract.
 */

import { prisma } from "@/lib/prisma";
import { getConnection, getFreshAccessToken } from "@/lib/integrations/connection-store";
import { recordAPIUsage } from "@/lib/api-usage";
import { getWhiteLabelEmailFrom } from "@/lib/white-label/resolve-brand";
import { checkSuppression } from "./suppression";
import { getOrCreateSendingIdentity, checkRateLimit, recordSendAttempt, applyRateLimitCooldown } from "./sending-identity";

export interface OutreachEmailInput {
  to: string;
  // Phase 3 Email Center — real Cc/Bcc recipients (EmailDraft.cc/.bcc in
  // prisma/schema.prisma). Optional/empty on every provider below never
  // sends an empty `cc`/`bcc` field to the provider — it's omitted entirely,
  // never sent as `""` or `[]`.
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
}

/** Undefined (never an empty array) when there's nothing real to send — every provider below treats "omit the field" and "empty array" as the same "no cc/bcc" case, but only the JS side ever sees the array form. */
function nonEmpty(emails: string[] | undefined): string[] | undefined {
  return emails && emails.length > 0 ? emails : undefined;
}

export type OutreachEmailResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      // Phase 4: "suppressed" and "rate_limited" are new, real outcomes this
      // safety layer can now return WITHOUT ever calling a provider API —
      // distinct from "failed" (a provider genuinely rejected/errored) so
      // callers can tell "we chose not to send" from "we tried and it broke".
      errorKind: "not_configured" | "failed" | "suppressed" | "rate_limited";
      error: string;
      // Populated only when a real provider response is known to have
      // returned it (Resend) — null/undefined everywhere else, never guessed.
      statusCode?: number;
      retryAfterSeconds?: number | null;
    };

export function isEmailSendingConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_SERVER);
}

// Phase 4 §11 — documented, configurable duplicate-send protection window.
const DUPLICATE_WINDOW_MS = 5 * 60_000;

async function sendViaResend(input: OutreachEmailInput, emailFrom: { name: string; address: string } | null): Promise<OutreachEmailResult> {
  try {
    const from = emailFrom ? `"${emailFrom.name}" <${emailFrom.address}>` : (process.env.EMAIL_FROM ?? "no-reply@kvlgrowthos.local");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        cc: nonEmpty(input.cc),
        bcc: nonEmpty(input.bcc),
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryAfterHeader = response.headers.get("retry-after");
      return {
        ok: false,
        errorKind: "failed",
        error: `Resend rejected the send (HTTP ${response.status}): ${body.slice(0, 200)}`,
        statusCode: response.status,
        retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) || null : null,
      };
    }
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerMessageId: typeof body?.id === "string" ? body.id : undefined };
  } catch (error) {
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "Resend request failed." };
  }
}

async function sendViaSmtp(input: OutreachEmailInput, emailFrom: { name: string; address: string } | null): Promise<OutreachEmailResult> {
  try {
    const from = emailFrom ? `"${emailFrom.name}" <${emailFrom.address}>` : (process.env.EMAIL_FROM ?? "no-reply@kvlgrowthos.local");
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(process.env.EMAIL_SERVER!);
    await transport.sendMail({
      to: input.to,
      from,
      cc: nonEmpty(input.cc),
      bcc: nonEmpty(input.bcc),
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "SMTP send failed." };
  }
}

async function sendViaGmail(
  organizationId: string,
  connectionId: string | undefined,
  accessToken: string,
  input: OutreachEmailInput,
): Promise<OutreachEmailResult> {
  const endpoint = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
  try {
    // The Gmail API's raw-MIME send determines real envelope recipients from
    // the To/Cc/Bcc headers actually present in the message — there is no
    // separate `cc`/`bcc` request field, so these are only ever added as
    // headers when non-empty (an absent header is genuinely no recipient,
    // never an empty "Cc: " line).
    const headerLines = [`To: ${input.to}`];
    if (input.cc?.length) headerLines.push(`Cc: ${input.cc.join(", ")}`);
    if (input.bcc?.length) headerLines.push(`Bcc: ${input.bcc.join(", ")}`);
    headerLines.push(`Subject: ${input.subject}`, "Content-Type: text/html; charset=utf-8", "");
    const message = [...headerLines, input.html].join("\r\n");
    const raw = Buffer.from(message).toString("base64url");

    const start = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    void recordAPIUsage({
      organizationId,
      integrationConnectionId: connectionId,
      endpoint,
      method: "POST",
      statusCode: response.status,
      responseTimeMs: Date.now() - start,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, errorKind: "failed", error: `Gmail rejected the send (HTTP ${response.status}): ${body.slice(0, 200)}` };
    }
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerMessageId: typeof body?.id === "string" ? body.id : undefined };
  } catch (error) {
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "Gmail request failed." };
  }
}

/** Microsoft Graph's sendMail wants `{ emailAddress: { address } }` objects, never bare strings — `undefined` (not `[]`) when there's nothing real to send, same "omit rather than send empty" rule as every other provider here. */
function toGraphRecipients(emails: string[] | undefined): Array<{ emailAddress: { address: string } }> | undefined {
  const cleaned = nonEmpty(emails);
  return cleaned ? cleaned.map((address) => ({ emailAddress: { address } })) : undefined;
}

async function sendViaOutlook(
  organizationId: string,
  connectionId: string | undefined,
  accessToken: string,
  input: OutreachEmailInput,
): Promise<OutreachEmailResult> {
  const endpoint = "https://graph.microsoft.com/v1.0/me/sendMail";
  try {
    const start = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: "HTML", content: input.html },
          toRecipients: [{ emailAddress: { address: input.to } }],
          ccRecipients: toGraphRecipients(input.cc),
          bccRecipients: toGraphRecipients(input.bcc),
        },
      }),
    });
    void recordAPIUsage({
      organizationId,
      integrationConnectionId: connectionId,
      endpoint,
      method: "POST",
      statusCode: response.status,
      responseTimeMs: Date.now() - start,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, errorKind: "failed", error: `Outlook rejected the send (HTTP ${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, errorKind: "failed", error: error instanceof Error ? error.message : "Outlook request failed." };
  }
}

/**
 * Sends a real outreach email. Returns `not_configured` honestly rather than
 * pretending success — never marks a draft SENT for nothing.
 *
 * Provider order: Gmail, then Outlook, then Resend, then SMTP. An org's own
 * connected mailbox (Gmail/Outlook) is preferred over the shared Resend
 * sender/SMTP relay because it sends from the org's real address — better
 * deliverability and sender reputation than a shared box, and the recipient
 * sees a familiar "from" address. Falling through to the next provider only
 * happens when the current one isn't CONFIGURED (getFreshAccessToken/env var
 * missing) — a connected provider that genuinely fails to send returns that
 * failure honestly instead of silently retrying through the list.
 */
export async function sendOutreachEmail(organizationId: string, input: OutreachEmailInput): Promise<OutreachEmailResult> {
  // Phase 4 (Email Deliverability & Sender Health Engine) — the single
  // suppression choke-point, checked BEFORE every provider branch below, so
  // Gmail/Outlook/Resend/SMTP are all covered by one edit. Fixes a real,
  // confirmed gap: previously nothing checked bouncedAt/complainedAt at
  // send time, and KVL's own automated outreach didn't even check
  // UNSUBSCRIBED. This is a deliberate BLOCK, not a soft warning — a
  // suppressed recipient must never receive outreach (rule 10).
  const suppression = await checkSuppression(organizationId, input.to);
  if (suppression.suppressed) {
    return { ok: false, errorKind: "suppressed", error: suppression.detail ?? `Recipient is suppressed (${suppression.reason}).` };
  }

  // Phase 4 §11 — real, server-side duplicate-recipient protection: a
  // second send to the same real email address within DUPLICATE_WINDOW_MS
  // of an already-SENT one (same org) is blocked. Catches an accidental
  // double-fire (a retried job, a race between two callers) without
  // interfering with a legitimate later re-send (a new campaign days
  // later, a follow-up in a sequence).
  const recentDuplicate = await prisma.emailDraft.findFirst({
    where: { organizationId, status: "SENT", sentAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) }, contact: { email: { equals: input.to, mode: "insensitive" } } },
    orderBy: { sentAt: "desc" },
  });
  if (recentDuplicate) {
    return {
      ok: false,
      errorKind: "failed",
      error: `Duplicate send blocked — an email was already sent to ${input.to} ${Math.round((Date.now() - (recentDuplicate.sentAt?.getTime() ?? 0)) / 1000)}s ago.`,
    };
  }

  const gmailToken = await getFreshAccessToken(organizationId, "GOOGLE_GMAIL");
  if (gmailToken) {
    const gmailConnection = await getConnection(organizationId, "GOOGLE_GMAIL");
    return sendViaGmail(organizationId, gmailConnection?.id, gmailToken, input);
  }

  const outlookToken = await getFreshAccessToken(organizationId, "MICROSOFT_OUTLOOK");
  if (outlookToken) {
    const outlookConnection = await getConnection(organizationId, "MICROSOFT_OUTLOOK");
    return sendViaOutlook(organizationId, outlookConnection?.id, outlookToken, input);
  }

  if (process.env.RESEND_API_KEY || process.env.EMAIL_SERVER) {
    const emailFrom = await getWhiteLabelEmailFrom(organizationId);
    const provider = process.env.RESEND_API_KEY ? "RESEND" : "SMTP";
    const fromAddress = emailFrom?.address ?? process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "no-reply@kvlgrowthos.local";

    // Phase 4: rate-limit / circuit-breaker gate — only for the shared
    // Resend/SMTP infrastructure (Gmail/Outlook send from each org's own
    // connected mailbox, a different risk profile not centrally pooled
    // today — see the Phase 4 report's Known Limitations). Checked
    // PRE-EMPTIVELY, before the real provider call, never relying solely
    // on the provider itself returning a 429.
    const identity = await getOrCreateSendingIdentity(organizationId, fromAddress, provider);
    const rateLimit = await checkRateLimit(identity);
    if (!rateLimit.allowed) {
      return { ok: false, errorKind: "rate_limited", error: rateLimit.reason ?? "Sending identity is currently rate-limited." };
    }

    const result = process.env.RESEND_API_KEY ? await sendViaResend(input, emailFrom) : await sendViaSmtp(input, emailFrom);

    await recordSendAttempt(identity.id, result.ok ? "sent" : "failed");
    if (!result.ok && result.statusCode === 429) {
      await applyRateLimitCooldown(identity.id, result.retryAfterSeconds ?? null);
    }
    return result;
  }
  return {
    ok: false,
    errorKind: "not_configured",
    error: "Email sending isn't configured for this environment yet — connect Gmail/Outlook, or set RESEND_API_KEY or EMAIL_SERVER to send real outreach email.",
  };
}
