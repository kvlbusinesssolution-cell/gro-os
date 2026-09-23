import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { encryptWithKey, decryptWithKey } from "@/lib/crypto/aes-gcm";
import type { Prisma, Webhook, WebhookDelivery, WebhookEventType } from "@/generated/prisma/client";
import { generateWebhookSecret } from "./webhook-signature";

export interface CreateWebhookInput {
  direction: "INCOMING" | "OUTGOING";
  workflowId?: string;
  targetUrl?: string;
  /** Phase 33: platform event-bus subscriptions this row should receive (see WebhookEventType). Only meaningful for OUTGOING. */
  eventTypes?: WebhookEventType[];
}

export interface WebhookDeliveryResult {
  statusCode?: number;
  success: boolean;
  attempt: number;
  error?: string;
}

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Encrypts/decrypts Webhook.encryptedSecret with its own dedicated env-var
 * key (WEBHOOK_SECRET_ENCRYPTION_KEY) — separate from
 * AGENT_MEMORY_ENCRYPTION_KEY, INTEGRATION_TOKEN_ENCRYPTION_KEY, and
 * SECRETS_MANAGER_ENCRYPTION_KEY — so rotating this key domain never
 * silently breaks any of the others, or vice versa.
 */
function encryptWebhookSecret(plaintext: string): string {
  return encryptWithKey(plaintext, requireEncryptionKey());
}

function decryptWebhookSecret_(encoded: string): string {
  return decryptWithKey(encoded, requireEncryptionKey());
}

function requireEncryptionKey(): string {
  const key = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to store webhook secrets.");
  }
  return key;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Creates a new Webhook row. The signing secret is generated fresh here,
 * encrypted before it's ever persisted, and its PLAINTEXT form is returned
 * to the caller exactly once (a "reveal-once" pattern mirroring
 * src/app/profile/actions.ts's createApiKey) — the caller's Server Action is
 * responsible for showing it to the user a single time; it can never be
 * retrieved again after this call returns, only rotated.
 */
export async function createWebhook(
  organizationId: string,
  input: CreateWebhookInput,
): Promise<{ webhook: Webhook; plaintextSecret: string }> {
  const plaintextSecret = generateWebhookSecret();
  const encryptedSecret = encryptWebhookSecret(plaintextSecret);

  if (input.direction === "INCOMING") {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = randomBytes(9).toString("base64url");
      try {
        const webhook = await prisma.webhook.create({
          data: {
            organizationId,
            workflowId: input.workflowId ?? undefined,
            direction: "INCOMING",
            slug,
            encryptedSecret,
          },
        });
        return { webhook, plaintextSecret };
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < MAX_SLUG_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new Error("Failed to generate a unique webhook slug after multiple attempts.");
  }

  const webhook = await prisma.webhook.create({
    data: {
      organizationId,
      workflowId: input.workflowId ?? undefined,
      direction: "OUTGOING",
      targetUrl: input.targetUrl ?? undefined,
      encryptedSecret,
      eventTypes: input.eventTypes ?? [],
    },
  });
  return { webhook, plaintextSecret };
}

/** Replaces the full set of platform event-bus subscriptions this webhook receives. An empty array unsubscribes it from every event without deleting the row (workflow-triggered delivery, if any, is unaffected). */
export async function updateWebhookEventTypes(
  webhookId: string,
  organizationId: string,
  eventTypes: WebhookEventType[],
): Promise<Webhook> {
  await requireOwnedWebhook(webhookId, organizationId);
  return prisma.webhook.update({ where: { id: webhookId }, data: { eventTypes } });
}

/**
 * Org-scoped webhook listing. Never selects encryptedSecret — the field is
 * structurally omitted from the query rather than merely unset on the
 * returned object, so a plaintext or ciphertext secret can never leak
 * through this function.
 */
export async function listWebhooks(organizationId: string, workflowId?: string): Promise<Webhook[]> {
  const rows = await prisma.webhook.findMany({
    where: { organizationId, workflowId: workflowId ?? undefined },
    select: {
      id: true,
      organizationId: true,
      workflowId: true,
      direction: true,
      slug: true,
      targetUrl: true,
      active: true,
      lastTriggeredAt: true,
      eventTypes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({ ...row, encryptedSecret: null }) as Webhook);
}

/**
 * Org-scoped: throws "Webhook not found" both when the row doesn't exist
 * and when it belongs to a different organization, so a cross-org access
 * attempt never leaks whether the id exists at all.
 */
async function requireOwnedWebhook(webhookId: string, organizationId: string): Promise<Webhook> {
  const webhook = await prisma.webhook.findFirst({ where: { id: webhookId, organizationId } });
  if (!webhook) throw new Error("Webhook not found");
  return webhook;
}

/** Generates+encrypts a brand-new secret and persists it, returning the plaintext once (same reveal-once pattern as createWebhook). */
export async function rotateWebhookSecret(
  webhookId: string,
  organizationId: string,
): Promise<{ plaintextSecret: string }> {
  await requireOwnedWebhook(webhookId, organizationId);

  const plaintextSecret = generateWebhookSecret();
  const encryptedSecret = encryptWebhookSecret(plaintextSecret);

  await prisma.webhook.update({
    where: { id: webhookId },
    data: { encryptedSecret },
  });

  return { plaintextSecret };
}

export async function toggleWebhookActive(webhookId: string, organizationId: string, active: boolean): Promise<Webhook> {
  await requireOwnedWebhook(webhookId, organizationId);
  return prisma.webhook.update({ where: { id: webhookId }, data: { active } });
}

export async function deleteWebhook(webhookId: string, organizationId: string): Promise<void> {
  await requireOwnedWebhook(webhookId, organizationId);
  await prisma.webhook.delete({ where: { id: webhookId } });
}

/**
 * Looks up an INCOMING webhook by its public slug — no org check here since
 * the slug itself (a 12-byte random token) IS the auth boundary for this
 * lookup, matching how the incoming receiver route (/api/webhooks/custom/[slug])
 * resolves which webhook a request is for. Any org-scoping the caller needs
 * happens after, keyed off the organizationId on the row this returns.
 */
export async function getWebhookBySlug(slug: string): Promise<Webhook | null> {
  return prisma.webhook.findUnique({ where: { slug } });
}

/** Real decrypt of Webhook.encryptedSecret. Null for an unsigned webhook (encryptedSecret === null) rather than throwing. */
export async function decryptWebhookSecret(webhook: Webhook): Promise<string | null> {
  if (!webhook.encryptedSecret) return null;
  return decryptWebhookSecret_(webhook.encryptedSecret);
}

/**
 * Records a real WebhookDelivery row for either direction. On a successful
 * delivery, also stamps Webhook.lastTriggeredAt so the management UI can
 * show real "last triggered" freshness without recomputing it from the
 * deliveries table on every render.
 */
export async function recordWebhookDelivery(
  webhookId: string,
  direction: "INCOMING" | "OUTGOING",
  payload: unknown,
  result: WebhookDeliveryResult,
): Promise<WebhookDelivery> {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId,
      direction,
      payload: payload as Prisma.InputJsonValue,
      statusCode: result.statusCode ?? undefined,
      success: result.success,
      attempt: result.attempt,
      error: result.error ?? undefined,
    },
  });

  if (result.success) {
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { lastTriggeredAt: new Date() },
    });
  }

  return delivery;
}

/** Org-scoped delivery history for a webhook, most recent first. */
export async function listWebhookDeliveries(
  webhookId: string,
  organizationId: string,
  limit = 50,
): Promise<WebhookDelivery[]> {
  await requireOwnedWebhook(webhookId, organizationId);

  return prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
