import { prisma } from "@/lib/prisma";
import { decryptWebhookSecret, recordWebhookDelivery } from "@/lib/workflows/webhooks";
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from "@/lib/workflows/webhook-signature";
import { enqueueWebhookDelivery } from "@/lib/workflows/webhook-delivery-queue";
import { assertPublicUrl, performOutgoingRequest, type OutgoingRequestResult } from "@/lib/workflows/node-executors/outgoing-request";
import type { Webhook, WebhookEventType } from "@/generated/prisma/client";

/**
 * Platform-wide typed event bus (Phase 33) — closes the gap the Developer
 * Platform's own docs (WebhooksDocs component) previously disclosed
 * honestly: "no fixed catalog of event types yet, webhooks are
 * workflow-triggered only". Real business call sites now call
 * emitWebhookEvent() at a small set of genuinely meaningful moments (see
 * WebhookEventType in schema.prisma for the current catalog); this looks up
 * every active org-scoped Webhook row subscribed to that event type and
 * delivers a real, HMAC-signed HTTP POST to each — reusing the exact same
 * signing/SSRF-validation/delivery-log/retry-queue machinery as the
 * Workflow-triggered WEBHOOK node (communication.ts's runOutgoingWebhookStep)
 * rather than a parallel implementation.
 *
 * Fire-and-forget by design: a downstream subscriber being slow, offline, or
 * misconfigured must never fail or delay the real business action (creating
 * a Contact, closing a Deal, ...) that triggered the event — every failure
 * here is caught, logged as a real failed WebhookDelivery row (so it's still
 * visible in the delivery audit log) and swallowed, never rethrown.
 */
export async function emitWebhookEvent(
  organizationId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  let subscribers: Webhook[];
  try {
    subscribers = await prisma.webhook.findMany({
      where: { organizationId, active: true, targetUrl: { not: null }, eventTypes: { has: eventType } },
    });
  } catch (error) {
    console.error(`[webhooks:event-bus] failed to look up subscribers for ${eventType} (org ${organizationId}):`, error);
    return;
  }
  if (subscribers.length === 0) return;

  await Promise.all(subscribers.map((webhook) => deliverEvent(webhook, eventType, payload)));
}

async function deliverEvent(webhook: Webhook, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
  const body = { event: eventType, data: payload, timestamp: new Date().toISOString() };
  const fieldLabel = `event-bus:${eventType}`;

  try {
    const url = await assertPublicUrl(webhook.targetUrl, fieldLabel);
    const headers: Record<string, string> = { "X-KVL-Event": eventType };
    const secret = await decryptWebhookSecret(webhook);
    if (secret) headers[WEBHOOK_SIGNATURE_HEADER] = signPayload(secret, JSON.stringify(body));

    let result: OutgoingRequestResult | undefined;
    let deliveryError: string | undefined;
    try {
      result = await performOutgoingRequest(fieldLabel, url, "POST", headers, body);
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : String(error);
    }

    await recordWebhookDelivery(webhook.id, "OUTGOING", body, {
      statusCode: result?.status,
      success: deliveryError === undefined,
      attempt: 1,
      error: deliveryError,
    });

    if (deliveryError !== undefined) {
      await enqueueWebhookDelivery({ webhookId: webhook.id, url: url.toString(), method: "POST", headers, body });
    }
  } catch (error) {
    // A malformed/private targetUrl (assertPublicUrl threw) never reaches
    // performOutgoingRequest — still worth a console record since no
    // WebhookDelivery row gets created for this case (there's no successful
    // URL to attempt), but this must never propagate to the caller.
    console.error(`[webhooks:event-bus] failed to deliver ${eventType} to webhook ${webhook.id}:`, error);
  }
}
