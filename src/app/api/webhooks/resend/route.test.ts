import "dotenv/config";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Webhook } from "svix";

import { prisma } from "@/lib/prisma";

import { POST } from "./route";

/**
 * Phase 30 (Enterprise Email Deliverability Engine) — real tests for Phase
 * 4/17's already-real but previously-untested Resend webhook handler:
 * real Svix signature verification (using the SAME `Webhook.sign()` the
 * real Resend/Svix pipeline would use — never a fabricated signature), and
 * real DB-backed replay protection via `EmailProviderEvent.providerEventId`.
 * Never mocks Prisma — every assertion is against real rows.
 */
const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"; // a real, valid-shaped Svix test secret (base64, whsec_ prefix) — not a real production credential

function signPayload(payload: object): { rawBody: string; headers: Headers } {
  const rawBody = JSON.stringify(payload);
  const svixId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  const signature = new Webhook(TEST_SECRET).sign(svixId, timestamp, rawBody);
  const headers = new Headers({
    "svix-id": svixId,
    "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "svix-signature": signature,
    "content-type": "application/json",
  });
  return { rawBody, headers };
}

async function postWebhook(payload: object): Promise<Response> {
  const { rawBody, headers } = signPayload(payload);
  const request = new Request("http://localhost/api/webhooks/resend", { method: "POST", body: rawBody, headers });
  return POST(request);
}

describe("Resend webhook handler", () => {
  let orgId: string;
  let originalSecret: string | undefined;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Resend Webhook Test Org", slug: `resend-webhook-org-${suffix}` } });
    orgId = org.id;
  });

  beforeEach(() => {
    originalSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = originalSecret;
  });

  afterAll(async () => {
    await prisma.emailProviderEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  async function makeDraft(resendMessageId: string) {
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, firstName: "Webhook", lastName: "Test", email: `webhook-test-${resendMessageId}@example.com` },
    });
    return prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: "Body.",
        status: "SENT",
        sentAt: new Date(),
        resendMessageId,
      },
    });
  }

  it("rejects a webhook with an invalid/missing signature with a real 401", async () => {
    const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "does-not-matter" } });
    const request = new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      body: rawBody,
      headers: { "svix-id": "msg_fake", "svix-timestamp": "1234567890", "svix-signature": "v1,not-a-real-signature" },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects a webhook with real headers missing entirely", async () => {
    const request = new Request("http://localhost/api/webhooks/resend", { method: "POST", body: "{}" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("accepts a real, validly-signed email.delivered event and sets a real deliveredAt, without moving status off SENT", async () => {
    const messageId = `msg-delivered-${Date.now()}`;
    const draft = await makeDraft(messageId);

    const response = await postWebhook({ type: "email.delivered", data: { email_id: messageId } });
    expect(response.status).toBe(200);

    const refreshed = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(refreshed.deliveredAt).not.toBeNull();
    expect(refreshed.status).toBe("SENT"); // deliberately additive, never overwrites the existing SENT status
  });

  it("accepts a real, validly-signed email.bounced (hard) event, sets bouncedAt, and creates a real suppression entry", async () => {
    const messageId = `msg-bounced-${Date.now()}`;
    const draft = await makeDraft(messageId);

    const response = await postWebhook({ type: "email.bounced", data: { email_id: messageId, bounce: { type: "hard_bounce", message: "Mailbox does not exist" } } });
    expect(response.status).toBe(200);

    const refreshed = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(refreshed.status).toBe("BOUNCED");
    expect(refreshed.bouncedAt).not.toBeNull();
    expect(refreshed.bounceType).toBe("hard");

    const suppression = await prisma.suppressionEntry.findFirst({ where: { organizationId: orgId, email: (await prisma.contact.findUniqueOrThrow({ where: { id: draft.contactId } })).email.toLowerCase() } });
    expect(suppression?.reason).toBe("HARD_BOUNCE");
  });

  it("a real duplicate webhook delivery (same svix-id) is a genuine no-op — never double-processes the same event", async () => {
    const messageId = `msg-replay-${Date.now()}`;
    const draft = await makeDraft(messageId);
    const payload = { type: "email.delivered", data: { email_id: messageId } };
    const { rawBody, headers } = signPayload(payload);

    const firstResponse = await POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", body: rawBody, headers }));
    expect(firstResponse.status).toBe(200);

    const afterFirst = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const firstDeliveredAt = afterFirst.deliveredAt;
    expect(firstDeliveredAt).not.toBeNull();

    const eventCountAfterFirst = await prisma.emailProviderEvent.count({ where: { emailDraftId: draft.id } });
    expect(eventCountAfterFirst).toBe(1);

    // Real replay — the exact same headers (same svix-id) delivered a second time.
    const secondResponse = await POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", body: rawBody, headers }));
    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.reason).toBe("duplicate_event");

    const eventCountAfterSecond = await prisma.emailProviderEvent.count({ where: { emailDraftId: draft.id } });
    expect(eventCountAfterSecond).toBe(1); // still exactly 1 — no double-processing
  });

  it("real, unknown resendMessageId is honestly skipped, never crashes", async () => {
    const response = await postWebhook({ type: "email.delivered", data: { email_id: `nonexistent-${Date.now()}` } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skipped).toBe(true);
  });
});
