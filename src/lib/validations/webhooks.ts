import { z } from "zod";

// Mirrors enum WebhookDirection in prisma/schema.prisma.
export const webhookDirectionSchema = z.enum(["INCOMING", "OUTGOING"]);
export type WebhookDirectionInput = z.infer<typeof webhookDirectionSchema>;

// Mirrors enum WebhookEventType in prisma/schema.prisma — the real,
// authoritative catalog. Keep in sync by hand (Zod has no way to import a
// Prisma enum directly without pulling generated client code into this
// validation-only module).
export const webhookEventTypeSchema = z.enum([
  "CONTACT_CREATED",
  "COMPANY_CREATED",
  "DEAL_WON",
  "DEAL_LOST",
  "APPLICATION_STATUS_CHANGED",
]);
export type WebhookEventTypeInput = z.infer<typeof webhookEventTypeSchema>;

/**
 * OUTGOING webhooks require a real targetUrl to POST to; INCOMING webhooks
 * never take one (the receivable URL is server-generated from the row's
 * slug instead) — the refine below enforces that split at the validation
 * layer so a malformed request never reaches src/lib/workflows/webhooks.ts.
 */
export const createWebhookSchema = z
  .object({
    direction: webhookDirectionSchema,
    workflowId: z.string().trim().min(1).optional(),
    targetUrl: z.string().trim().url("Enter a valid https:// URL.").max(2000).optional(),
    // Phase 33: platform event-bus subscriptions for this webhook. Only
    // meaningful for OUTGOING; a workflow-scoped webhook created from the
    // Automation Builder simply omits this and stays exactly as before.
    eventTypes: z.array(webhookEventTypeSchema).max(webhookEventTypeSchema.options.length).optional(),
  })
  .refine((data) => data.direction !== "OUTGOING" || Boolean(data.targetUrl), {
    message: "A target URL is required for outgoing webhooks.",
    path: ["targetUrl"],
  });
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
