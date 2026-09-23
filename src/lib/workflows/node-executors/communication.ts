import type { NodeExecutionContext, NodeExecutionResult, NodeExecutorMap } from "./types";
import { sendOutreachEmail } from "@/lib/outreach/email-provider";
import { notifyUser, notifyOrganizationOwners } from "@/lib/notifications";
import { getSecret } from "@/lib/secrets/store";
import { getFreshAccessToken } from "@/lib/integrations/connection-store";
import { prisma } from "@/lib/prisma";
import { decryptWebhookSecret, recordWebhookDelivery } from "@/lib/workflows/webhooks";
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from "@/lib/workflows/webhook-signature";
import { enqueueWebhookDelivery } from "@/lib/workflows/webhook-delivery-queue";
import { assertPublicUrl, performOutgoingRequest, readOutgoingRequestConfig, type OutgoingRequestResult } from "./outgoing-request";
import type { NotificationType, Webhook } from "@/generated/prisma/client";

export { WEBHOOK_SIGNATURE_HEADER };

const NOTIFICATION_TYPES = new Set<NotificationType>([
  "MEETING_STARTED",
  "MEETING_ENDED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "DECISION_MADE",
  "NEW_RECOMMENDATION",
  "CRITICAL_ALERT",
  "APPROVAL_REQUESTED",
  "EMAIL_READY",
  "CRM_EVENT",
  "AUTOMATION_EVENT",
  "SYSTEM_NOTICE",
  "PROPOSAL_SENT",
  "PROPOSAL_ACCEPTED",
  "PROPOSAL_REJECTED",
  "CONTRACT_SIGNED",
  "INVOICE_PAID",
  "BOARD_REVIEW_STARTED",
  "BOARD_REVIEW_COMPLETED",
  "PROJECT_CREATED",
  "MILESTONE_COMPLETED",
  "RISK_DETECTED",
  "DEADLINE_APPROACHING",
  "CLIENT_COMMENT_ADDED",
  "CLIENT_APPROVED_MILESTONE",
  "DELIVERY_HEALTH_DROPPED",
]);

function resolveNotificationType(raw: unknown): NotificationType {
  if (typeof raw === "string" && NOTIFICATION_TYPES.has(raw as NotificationType)) return raw as NotificationType;
  return "AUTOMATION_EVENT";
}

/**
 * Org-scoped Webhook row lookup for an optional `config.webhookId` — throws
 * (rather than silently ignoring a bad id) so a misconfigured/deleted
 * Webhook reference fails the step honestly instead of quietly falling back
 * to raw ad-hoc behavior.
 */
async function lookupWebhookRow(webhookId: string, organizationId: string, fieldLabel: string): Promise<Webhook> {
  const webhook = await prisma.webhook.findFirst({ where: { id: webhookId, organizationId } });
  if (!webhook) {
    throw new Error(`${fieldLabel} node's "webhookId" ("${webhookId}") was not found for this organization.`);
  }
  return webhook;
}

/**
 * Shared implementation behind both WEBHOOK and CUSTOM_API — same real SSRF
 * validation + fetch as before this batch, now optionally associated with a
 * real `Webhook` row via `config.webhookId`:
 *  - when present: `webhook.targetUrl` is used as a fallback URL if the step
 *    doesn't set its own explicit `config.url`, the outgoing JSON body is
 *    HMAC-signed with the webhook's decrypted secret (header name:
 *    WEBHOOK_SIGNATURE_HEADER), and every delivery attempt is recorded as a
 *    real WebhookDelivery row.
 *  - when absent: behaves exactly as before this batch — raw ad-hoc URL, no
 *    signing, no delivery audit trail, no retry-queue involvement. Still a
 *    fully valid, simpler configuration.
 *
 * Dual-path retry design (intentional): this function still awaits exactly
 * ONE real immediate HTTP attempt, so the workflow step's success/failure
 * decision remains unchanged and immediate — a flaky downstream endpoint
 * does not make the engine wait around for retries. That first attempt's
 * real outcome is what recordWebhookDelivery logs and what the executor
 * throws/returns on. Only when a Webhook row IS associated AND that first
 * attempt failed does this additionally call enqueueWebhookDelivery to hand
 * the same request to webhook-delivery-queue.ts's dedicated BullMQ queue,
 * which keeps retrying with real exponential backoff in the background and
 * logs each further attempt as its own WebhookDelivery row. Those
 * background outcomes never reopen or flip the already-FAILED
 * WorkflowStepRun — see webhook-delivery-queue.ts's enqueueWebhookDelivery
 * doc comment for that limitation.
 */
async function runOutgoingWebhookStep(
  fieldLabel: string,
  config: Record<string, unknown>,
  context: NodeExecutionContext,
  applyExtraHeaders?: (headers: Record<string, string>) => Promise<void>,
): Promise<NodeExecutionResult> {
  const webhookIdRaw = config.webhookId;
  const webhook =
    typeof webhookIdRaw === "string" && webhookIdRaw.trim() !== ""
      ? await lookupWebhookRow(webhookIdRaw, context.organizationId, fieldLabel)
      : null;

  const rawUrl = typeof config.url === "string" && config.url.trim() !== "" ? config.url : (webhook?.targetUrl ?? undefined);
  const url = await assertPublicUrl(rawUrl, fieldLabel);
  const { method, headers, body } = readOutgoingRequestConfig(config, fieldLabel);

  if (applyExtraHeaders) await applyExtraHeaders(headers);

  if (webhook) {
    const secret = await decryptWebhookSecret(webhook);
    if (secret) {
      const rawBody = body !== undefined ? JSON.stringify(body) : "";
      headers[WEBHOOK_SIGNATURE_HEADER] = signPayload(secret, rawBody);
    }
  }

  let result: OutgoingRequestResult | undefined;
  let deliveryError: string | undefined;
  try {
    result = await performOutgoingRequest(fieldLabel, url, method, headers, body);
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : String(error);
  }

  if (webhook) {
    await recordWebhookDelivery(webhook.id, "OUTGOING", body ?? null, {
      statusCode: result?.status,
      success: deliveryError === undefined,
      attempt: 1,
      error: deliveryError,
    });
    if (deliveryError !== undefined) {
      await enqueueWebhookDelivery({ webhookId: webhook.id, url: url.toString(), method, headers, body });
    }
  }

  if (deliveryError !== undefined) throw new Error(deliveryError);
  return { output: { status: result!.status, body: result!.body } };
}

export const COMMUNICATION_EXECUTORS: NodeExecutorMap = {
  // config: { to: string, subject: string, body: string, useConnectedMailbox?: boolean }
  // "useConnectedMailbox" is accepted for forward-compat with the config UI
  // but sendOutreachEmail() itself already always prefers a connected
  // Gmail/Outlook mailbox over Resend/SMTP when one is available — there is
  // no separate code path to gate on here.
  EMAIL: async (config, context) => {
    const to = config.to;
    const subject = config.subject;
    const body = config.body;
    if (typeof to !== "string" || to.trim() === "") throw new Error('EMAIL node config must include a non-empty string "to".');
    if (typeof subject !== "string" || subject.trim() === "") throw new Error('EMAIL node config must include a non-empty string "subject".');
    if (typeof body !== "string" || body.trim() === "") throw new Error('EMAIL node config must include a non-empty string "body".');

    const result = await sendOutreachEmail(context.organizationId, { to, subject, html: body, text: body });
    if (!result.ok) {
      if (result.errorKind === "not_configured") {
        throw new Error("Email sending isn't configured for this organization — connect Gmail/Outlook, or set RESEND_API_KEY or EMAIL_SERVER.");
      }
      throw new Error(`EMAIL node failed to send: ${result.error}`);
    }
    return { output: { sentTo: to, providerMessageId: result.providerMessageId ?? null } };
  },

  // config: { to: string, body: string } — sends via the organization's
  // connected Twilio account (src/lib/integrations/providers/twilio.ts).
  // The stored "access token" for TWILIO is JSON.stringify({accountSid,
  // authToken}) — both fields are required on every Twilio REST call, not a
  // single bearer token, which is why this reads it back with JSON.parse
  // rather than using the raw string directly.
  SMS: async (config, context) => {
    const to = config.to;
    const body = config.body;
    if (typeof to !== "string" || to.trim() === "") throw new Error('SMS node config must include a non-empty string "to".');
    if (typeof body !== "string" || body.trim() === "") throw new Error('SMS node config must include a non-empty string "body".');

    const from = config.from;
    if (typeof from !== "string" || from.trim() === "") {
      throw new Error('SMS node config must include a "from" number — the Twilio phone number to send from.');
    }

    const credential = await getFreshAccessToken(context.organizationId, "TWILIO");
    if (!credential) {
      throw new Error("SMS sending requires a connected Twilio account — connect one at /dashboard/settings/integrations.");
    }
    const { accountSid, authToken } = JSON.parse(credential) as { accountSid: string; authToken: string };

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    const responseBody = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok) {
      throw new Error(`Twilio rejected this message (HTTP ${response.status}): ${responseBody.message ?? "unknown error"}`);
    }
    return { output: { sentTo: to, messageSid: responseBody.sid ?? null } };
  },

  // config: { url?: string, webhookId?: string, method?: "POST"|"GET"|"PUT"|"PATCH"|"DELETE", headers?: Record<string,string>, body?: unknown }
  // Outgoing action webhook — fires a real HTTP request out to either a raw
  // ad-hoc `url`, or (when `webhookId` is set) a real named `Webhook` row's
  // `targetUrl` with real HMAC request-signing and delivery audit
  // logging/retry — see runOutgoingWebhookStep's doc comment for the full
  // dual-path design. Distinct from an incoming webhook TRIGGER, which is a
  // separate node type/batch.
  WEBHOOK: async (config, context) => runOutgoingWebhookStep("WEBHOOK", config, context),

  // config: { recipientUserId?: string, notifyAllOwners?: boolean, title: string, message: string, type?: string }
  // Exactly one of recipientUserId / notifyAllOwners must be set.
  NOTIFICATION: async (config, context) => {
    const title = config.title;
    const message = config.message;
    if (typeof title !== "string" || title.trim() === "") throw new Error('NOTIFICATION node config must include a non-empty string "title".');
    if (typeof message !== "string" || message.trim() === "") throw new Error('NOTIFICATION node config must include a non-empty string "message".');

    const type = resolveNotificationType(config.type);
    const recipientUserId = config.recipientUserId;
    const notifyAllOwners = config.notifyAllOwners === true;

    if (typeof recipientUserId === "string" && recipientUserId.trim() !== "") {
      await notifyUser({ userId: recipientUserId, organizationId: context.organizationId, type, title, message });
      return { output: { recipientUserId, type } };
    }
    if (notifyAllOwners) {
      await notifyOrganizationOwners({ organizationId: context.organizationId, type, title, message });
      return { output: { notifiedAllOwners: true, type } };
    }
    throw new Error('NOTIFICATION node config must set either "recipientUserId" or "notifyAllOwners".');
  },

  // config: { url?: string, webhookId?: string, method?: "POST"|"GET"|"PUT"|"PATCH"|"DELETE", headers?: Record<string,string>, body?: unknown, secretKey?: string, secretHeaderName?: string }
  // Same real outgoing fetch + optional webhookId association as WEBHOOK,
  // plus its own separate optional Secrets Manager lookup injected as an
  // outgoing header — the decrypted value is used only inside the request
  // and is never included in the returned output. secretKey (Secrets
  // Manager) and webhookId (HMAC signing) are independent and can both be
  // set on the same step.
  CUSTOM_API: async (config, context) =>
    runOutgoingWebhookStep("CUSTOM_API", config, context, async (headers) => {
      const secretKey = config.secretKey;
      if (typeof secretKey === "string" && secretKey.trim() !== "") {
        const secretValue = await getSecret(context.organizationId, secretKey);
        if (secretValue === null) {
          throw new Error(`CUSTOM_API node's secretKey "${secretKey}" was not found in this organization's Secrets Manager.`);
        }
        const headerName = typeof config.secretHeaderName === "string" && config.secretHeaderName.trim() !== "" ? config.secretHeaderName : "Authorization";
        headers[headerName] = secretValue;
      }
    }),
};
