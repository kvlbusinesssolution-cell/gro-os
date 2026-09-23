import { describe, expect, it, vi, beforeEach } from "vitest";

const webhookFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { webhook: { findMany: (...args: unknown[]) => webhookFindMany(...args) } },
}));

const decryptWebhookSecret = vi.fn();
const recordWebhookDelivery = vi.fn();
vi.mock("@/lib/workflows/webhooks", () => ({
  decryptWebhookSecret: (...args: unknown[]) => decryptWebhookSecret(...args),
  recordWebhookDelivery: (...args: unknown[]) => recordWebhookDelivery(...args),
}));

const signPayload = vi.fn();
vi.mock("@/lib/workflows/webhook-signature", () => ({
  signPayload: (...args: unknown[]) => signPayload(...args),
  WEBHOOK_SIGNATURE_HEADER: "X-KVL-Signature",
}));

const enqueueWebhookDelivery = vi.fn();
vi.mock("@/lib/workflows/webhook-delivery-queue", () => ({
  enqueueWebhookDelivery: (...args: unknown[]) => enqueueWebhookDelivery(...args),
}));

const assertPublicUrl = vi.fn();
const performOutgoingRequest = vi.fn();
vi.mock("@/lib/workflows/node-executors/outgoing-request", () => ({
  assertPublicUrl: (...args: unknown[]) => assertPublicUrl(...args),
  performOutgoingRequest: (...args: unknown[]) => performOutgoingRequest(...args),
}));

import { emitWebhookEvent } from "./event-bus";

function makeWebhook(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "webhook_1", organizationId: "org_1", targetUrl: "https://example.com/hook", active: true, eventTypes: ["CONTACT_CREATED"], ...overrides };
}

describe("emitWebhookEvent — Phase 33 real platform event-bus delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertPublicUrl.mockImplementation(async (raw: string) => new URL(raw));
  });

  it("looks up subscribers scoped to org + active + the exact eventType, never fetching every webhook in the org", async () => {
    webhookFindMany.mockResolvedValue([]);
    await emitWebhookEvent("org_1", "CONTACT_CREATED", { contactId: "c1" });

    expect(webhookFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", active: true, targetUrl: { not: null }, eventTypes: { has: "CONTACT_CREATED" } },
    });
    expect(performOutgoingRequest).not.toHaveBeenCalled();
  });

  it("does nothing further when there are no real subscribers", async () => {
    webhookFindMany.mockResolvedValue([]);
    await emitWebhookEvent("org_1", "DEAL_WON", { dealId: "d1" });
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it("delivers a real HMAC-signed POST and records a successful WebhookDelivery, without enqueueing a retry", async () => {
    const webhook = makeWebhook();
    webhookFindMany.mockResolvedValue([webhook]);
    decryptWebhookSecret.mockResolvedValue("real-secret");
    signPayload.mockReturnValue("sig-abc");
    performOutgoingRequest.mockResolvedValue({ status: 200, body: { ok: true } });

    await emitWebhookEvent("org_1", "CONTACT_CREATED", { contactId: "c1", email: "a@b.com" });

    expect(performOutgoingRequest).toHaveBeenCalledTimes(1);
    const [, , method, headers, body] = performOutgoingRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(headers["X-KVL-Signature"]).toBe("sig-abc");
    expect(headers["X-KVL-Event"]).toBe("CONTACT_CREATED");
    expect(body).toMatchObject({ event: "CONTACT_CREATED", data: { contactId: "c1", email: "a@b.com" } });

    expect(recordWebhookDelivery).toHaveBeenCalledWith(
      "webhook_1",
      "OUTGOING",
      expect.objectContaining({ event: "CONTACT_CREATED" }),
      { statusCode: 200, success: true, attempt: 1, error: undefined },
    );
    expect(enqueueWebhookDelivery).not.toHaveBeenCalled();
  });

  it("never signs the request when the webhook has no secret on file (unsigned but still delivered)", async () => {
    webhookFindMany.mockResolvedValue([makeWebhook()]);
    decryptWebhookSecret.mockResolvedValue(null);
    performOutgoingRequest.mockResolvedValue({ status: 200, body: {} });

    await emitWebhookEvent("org_1", "CONTACT_CREATED", {});

    const [, , , headers] = performOutgoingRequest.mock.calls[0];
    expect(headers["X-KVL-Signature"]).toBeUndefined();
    expect(signPayload).not.toHaveBeenCalled();
  });

  it("records a real failed WebhookDelivery and enqueues a background retry when the first delivery attempt fails", async () => {
    const webhook = makeWebhook();
    webhookFindMany.mockResolvedValue([webhook]);
    decryptWebhookSecret.mockResolvedValue(null);
    performOutgoingRequest.mockRejectedValue(new Error("connection refused"));

    await emitWebhookEvent("org_1", "DEAL_LOST", { dealId: "d1" });

    expect(recordWebhookDelivery).toHaveBeenCalledWith(
      "webhook_1",
      "OUTGOING",
      expect.objectContaining({ event: "DEAL_LOST" }),
      { statusCode: undefined, success: false, attempt: 1, error: "connection refused" },
    );
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ webhookId: "webhook_1", method: "POST" }),
    );
  });

  it("never throws back to the caller when the target URL itself is rejected (e.g. a private/internal address) — swallows and logs instead", async () => {
    webhookFindMany.mockResolvedValue([makeWebhook({ targetUrl: "http://169.254.169.254/" })]);
    assertPublicUrl.mockRejectedValue(new Error("targets a private/internal IP address"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(emitWebhookEvent("org_1", "CONTACT_CREATED", {})).resolves.toBeUndefined();
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("delivers independently to every subscribed webhook — one failure never blocks another's real delivery", async () => {
    const webhookA = makeWebhook({ id: "webhook_a", targetUrl: "https://a.example.com/hook" });
    const webhookB = makeWebhook({ id: "webhook_b", targetUrl: "https://b.example.com/hook" });
    webhookFindMany.mockResolvedValue([webhookA, webhookB]);
    decryptWebhookSecret.mockResolvedValue(null);
    performOutgoingRequest.mockImplementation(async (_label: string, url: URL) => {
      if (url.toString().includes("a.example.com")) throw new Error("a failed");
      return { status: 200, body: {} };
    });

    await emitWebhookEvent("org_1", "COMPANY_CREATED", { companyId: "co1" });

    expect(recordWebhookDelivery).toHaveBeenCalledWith("webhook_a", "OUTGOING", expect.anything(), expect.objectContaining({ success: false }));
    expect(recordWebhookDelivery).toHaveBeenCalledWith("webhook_b", "OUTGOING", expect.anything(), expect.objectContaining({ success: true }));
  });
});
