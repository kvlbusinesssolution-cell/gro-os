import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMUNICATION_EXECUTORS, WEBHOOK_SIGNATURE_HEADER } from "./communication";
import type { NodeExecutionContext } from "./types";

const sendOutreachEmail = vi.fn();
vi.mock("@/lib/outreach/email-provider", () => ({
  sendOutreachEmail: (...args: unknown[]) => sendOutreachEmail(...args),
}));

const notifyUser = vi.fn();
const notifyOrganizationOwners = vi.fn();
vi.mock("@/lib/notifications", () => ({
  notifyUser: (...args: unknown[]) => notifyUser(...args),
  notifyOrganizationOwners: (...args: unknown[]) => notifyOrganizationOwners(...args),
}));

const getSecret = vi.fn();
vi.mock("@/lib/secrets/store", () => ({
  getSecret: (...args: unknown[]) => getSecret(...args),
}));

const getFreshAccessToken = vi.fn();
vi.mock("@/lib/integrations/connection-store", () => ({
  getFreshAccessToken: (...args: unknown[]) => getFreshAccessToken(...args),
}));

const webhookFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { webhook: { findFirst: (...args: unknown[]) => webhookFindFirst(...args) } },
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
const readOutgoingRequestConfig = vi.fn();
vi.mock("./outgoing-request", () => ({
  assertPublicUrl: (...args: unknown[]) => assertPublicUrl(...args),
  performOutgoingRequest: (...args: unknown[]) => performOutgoingRequest(...args),
  readOutgoingRequestConfig: (...args: unknown[]) => readOutgoingRequestConfig(...args),
}));

function makeContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    organizationId: "org_1",
    workflowRunId: "run_1",
    workflowStepId: "step_1",
    triggerPayload: {},
    stepOutputs: {},
    ...overrides,
  };
}

const EMAIL = COMMUNICATION_EXECUTORS.EMAIL;
const SMS = COMMUNICATION_EXECUTORS.SMS;
const WEBHOOK = COMMUNICATION_EXECUTORS.WEBHOOK;
const NOTIFICATION = COMMUNICATION_EXECUTORS.NOTIFICATION;
const CUSTOM_API = COMMUNICATION_EXECUTORS.CUSTOM_API;
if (!EMAIL || !SMS || !WEBHOOK || !NOTIFICATION || !CUSTOM_API) {
  throw new Error("One or more COMMUNICATION_EXECUTORS entries are not registered.");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path stubs for the outgoing-request helpers so WEBHOOK/CUSTOM_API
  // tests that don't care about them still resolve deterministically.
  assertPublicUrl.mockImplementation(async (raw: unknown) => new URL(String(raw)));
  readOutgoingRequestConfig.mockImplementation((config: Record<string, unknown>) => ({
    method: typeof config.method === "string" ? config.method.toUpperCase() : "POST",
    headers: { ...((config.headers as Record<string, string>) ?? {}) },
    body: config.body,
  }));
  performOutgoingRequest.mockResolvedValue({ status: 200, body: { ok: true } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EMAIL node executor", () => {
  it("throws for a missing/blank 'to', 'subject', or 'body'", async () => {
    const context = makeContext();
    await expect(EMAIL({ subject: "s", body: "b" }, context)).rejects.toThrow(/non-empty string "to"/);
    await expect(EMAIL({ to: "a@b.com", body: "b" }, context)).rejects.toThrow(/non-empty string "subject"/);
    await expect(EMAIL({ to: "a@b.com", subject: "s" }, context)).rejects.toThrow(/non-empty string "body"/);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("sends a real email through sendOutreachEmail and returns the provider message id on success", async () => {
    sendOutreachEmail.mockResolvedValue({ ok: true, providerMessageId: "msg_123" });
    const context = makeContext();
    const result = await EMAIL({ to: "a@b.com", subject: "Hi", body: "Hello there" }, context);
    expect(sendOutreachEmail).toHaveBeenCalledWith("org_1", { to: "a@b.com", subject: "Hi", html: "Hello there", text: "Hello there" });
    expect(result).toEqual({ output: { sentTo: "a@b.com", providerMessageId: "msg_123" } });
  });

  it("throws a specific 'not configured' message when the org has no email provider connected", async () => {
    sendOutreachEmail.mockResolvedValue({ ok: false, errorKind: "not_configured", error: "no provider" });
    await expect(EMAIL({ to: "a@b.com", subject: "Hi", body: "Hello" }, makeContext())).rejects.toThrow(/Email sending isn't configured/);
  });

  it("surfaces the real provider error message for a genuine send failure", async () => {
    sendOutreachEmail.mockResolvedValue({ ok: false, errorKind: "failed", error: "provider rejected the message" });
    await expect(EMAIL({ to: "a@b.com", subject: "Hi", body: "Hello" }, makeContext())).rejects.toThrow(/provider rejected the message/);
  });
});

describe("SMS node executor", () => {
  it("throws for a missing/blank 'to', 'body', or 'from'", async () => {
    const context = makeContext();
    await expect(SMS({ body: "b", from: "+1" }, context)).rejects.toThrow(/non-empty string "to"/);
    await expect(SMS({ to: "+2", from: "+1" }, context)).rejects.toThrow(/non-empty string "body"/);
    await expect(SMS({ to: "+2", body: "b" }, context)).rejects.toThrow(/must include a "from" number/);
    expect(getFreshAccessToken).not.toHaveBeenCalled();
  });

  it("throws when the org has no connected Twilio account", async () => {
    getFreshAccessToken.mockResolvedValue(null);
    await expect(SMS({ to: "+2", body: "hi", from: "+1" }, makeContext())).rejects.toThrow(/requires a connected Twilio account/);
  });

  it("sends via the real Twilio REST API using the stored accountSid/authToken and returns the message sid", async () => {
    getFreshAccessToken.mockResolvedValue(JSON.stringify({ accountSid: "AC123", authToken: "tok" }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: "SM999" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await SMS({ to: "+15550001111", body: "hello", from: "+15559998888" }, makeContext());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    expect(init.body).toBe(new URLSearchParams({ To: "+15550001111", From: "+15559998888", Body: "hello" }).toString());
    expect(result).toEqual({ output: { sentTo: "+15550001111", messageSid: "SM999" } });
  });

  it("throws with Twilio's real rejection message on a non-ok response", async () => {
    getFreshAccessToken.mockResolvedValue(JSON.stringify({ accountSid: "AC123", authToken: "tok" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "invalid number" }), { status: 400 })));
    await expect(SMS({ to: "bad", body: "hi", from: "+1" }, makeContext())).rejects.toThrow(/Twilio rejected this message \(HTTP 400\): invalid number/);
  });
});

describe("NOTIFICATION node executor", () => {
  it("throws for a missing/blank 'title' or 'message'", async () => {
    const context = makeContext();
    await expect(NOTIFICATION({ message: "m" }, context)).rejects.toThrow(/non-empty string "title"/);
    await expect(NOTIFICATION({ title: "t" }, context)).rejects.toThrow(/non-empty string "message"/);
  });

  it("throws when neither recipientUserId nor notifyAllOwners is set", async () => {
    await expect(NOTIFICATION({ title: "t", message: "m" }, makeContext())).rejects.toThrow(/must set either "recipientUserId" or "notifyAllOwners"/);
  });

  it("notifies a single real user by id and passes through a known NotificationType", async () => {
    const context = makeContext();
    const result = await NOTIFICATION({ title: "t", message: "m", recipientUserId: "user_1", type: "TASK_ASSIGNED" }, context);
    expect(notifyUser).toHaveBeenCalledWith({ userId: "user_1", organizationId: "org_1", type: "TASK_ASSIGNED", title: "t", message: "m" });
    expect(notifyOrganizationOwners).not.toHaveBeenCalled();
    expect(result).toEqual({ output: { recipientUserId: "user_1", type: "TASK_ASSIGNED" } });
  });

  it("falls back to AUTOMATION_EVENT for an unrecognized notification type", async () => {
    const result = await NOTIFICATION({ title: "t", message: "m", recipientUserId: "user_1", type: "not_a_real_type" }, makeContext());
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ type: "AUTOMATION_EVENT" }));
    expect(result.output?.type).toBe("AUTOMATION_EVENT");
  });

  it("defaults to AUTOMATION_EVENT when no type is given at all", async () => {
    await NOTIFICATION({ title: "t", message: "m", recipientUserId: "user_1" }, makeContext());
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ type: "AUTOMATION_EVENT" }));
  });

  it("notifies all organization owners when notifyAllOwners is true, and recipientUserId wins if both are set", async () => {
    const result = await NOTIFICATION({ title: "t", message: "m", notifyAllOwners: true }, makeContext());
    expect(notifyOrganizationOwners).toHaveBeenCalledWith({ organizationId: "org_1", type: "AUTOMATION_EVENT", title: "t", message: "m" });
    expect(result).toEqual({ output: { notifiedAllOwners: true, type: "AUTOMATION_EVENT" } });

    vi.clearAllMocks();
    await NOTIFICATION({ title: "t", message: "m", recipientUserId: "user_1", notifyAllOwners: true }, makeContext());
    expect(notifyUser).toHaveBeenCalled();
    expect(notifyOrganizationOwners).not.toHaveBeenCalled();
  });
});

describe("WEBHOOK node executor (ad-hoc, no webhookId)", () => {
  it("uses the explicit config.url and never looks up a Webhook row when webhookId is absent", async () => {
    const context = makeContext();
    const result = await WEBHOOK({ url: "https://example.com/hook", body: { x: 1 } }, context);
    expect(webhookFindFirst).not.toHaveBeenCalled();
    expect(assertPublicUrl).toHaveBeenCalledWith("https://example.com/hook", "WEBHOOK");
    expect(performOutgoingRequest).toHaveBeenCalled();
    expect(result).toEqual({ output: { status: 200, body: { ok: true } } });
  });

  it("propagates assertPublicUrl's rejection (e.g. for a missing/private url) without calling performOutgoingRequest", async () => {
    assertPublicUrl.mockRejectedValue(new Error('WEBHOOK node config must include a non-empty string "url".'));
    await expect(WEBHOOK({}, makeContext())).rejects.toThrow(/must include a non-empty string "url"/);
    expect(performOutgoingRequest).not.toHaveBeenCalled();
  });
});

describe("WEBHOOK node executor (associated with a real Webhook row via webhookId)", () => {
  it("throws when the given webhookId does not resolve to a Webhook row for this organization", async () => {
    webhookFindFirst.mockResolvedValue(null);
    await expect(WEBHOOK({ webhookId: "wh_missing" }, makeContext())).rejects.toThrow(/"webhookId" \("wh_missing"\) was not found for this organization/);
    expect(webhookFindFirst).toHaveBeenCalledWith({ where: { id: "wh_missing", organizationId: "org_1" } });
  });

  it("falls back to the Webhook row's targetUrl when config.url is not set", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1", targetUrl: "https://target.example.com/hook", encryptedSecret: null });
    decryptWebhookSecret.mockResolvedValue(null);
    await WEBHOOK({ webhookId: "wh_1" }, makeContext());
    expect(assertPublicUrl).toHaveBeenCalledWith("https://target.example.com/hook", "WEBHOOK");
  });

  it("signs the outgoing body with the webhook's decrypted secret and sets the signature header", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1", targetUrl: "https://target.example.com/hook", encryptedSecret: "enc" });
    decryptWebhookSecret.mockResolvedValue("real-secret");
    signPayload.mockReturnValue("sig-abc123");

    await WEBHOOK({ webhookId: "wh_1", body: { x: 1 } }, makeContext());

    expect(signPayload).toHaveBeenCalledWith("real-secret", JSON.stringify({ x: 1 }));
    const requestCallHeaders = performOutgoingRequest.mock.calls[0][3] as Record<string, string>;
    expect(requestCallHeaders[WEBHOOK_SIGNATURE_HEADER]).toBe("sig-abc123");
  });

  it("does not sign when the webhook has no encrypted secret", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1", targetUrl: "https://target.example.com/hook", encryptedSecret: null });
    decryptWebhookSecret.mockResolvedValue(null);

    await WEBHOOK({ webhookId: "wh_1" }, makeContext());

    expect(signPayload).not.toHaveBeenCalled();
    const requestCallHeaders = performOutgoingRequest.mock.calls[0][3] as Record<string, string>;
    expect(requestCallHeaders[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });

  it("records a successful delivery and does not enqueue a background retry", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1", targetUrl: "https://target.example.com/hook", encryptedSecret: null });
    decryptWebhookSecret.mockResolvedValue(null);
    performOutgoingRequest.mockResolvedValue({ status: 200, body: { ok: true } });

    await WEBHOOK({ webhookId: "wh_1", body: { x: 1 } }, makeContext());

    expect(recordWebhookDelivery).toHaveBeenCalledWith("wh_1", "OUTGOING", { x: 1 }, { statusCode: 200, success: true, attempt: 1, error: undefined });
    expect(enqueueWebhookDelivery).not.toHaveBeenCalled();
  });

  it("records a failed delivery, enqueues a background retry, AND still throws the real error for this run", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1", targetUrl: "https://target.example.com/hook", encryptedSecret: null });
    decryptWebhookSecret.mockResolvedValue(null);
    performOutgoingRequest.mockRejectedValue(new Error("WEBHOOK node's request failed with HTTP 500: boom"));

    await expect(WEBHOOK({ webhookId: "wh_1", body: { x: 1 } }, makeContext())).rejects.toThrow(/failed with HTTP 500: boom/);

    expect(recordWebhookDelivery).toHaveBeenCalledWith(
      "wh_1",
      "OUTGOING",
      { x: 1 },
      { statusCode: undefined, success: false, attempt: 1, error: "WEBHOOK node's request failed with HTTP 500: boom" },
    );
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith({
      webhookId: "wh_1",
      url: "https://target.example.com/hook",
      method: "POST",
      headers: {},
      body: { x: 1 },
    });
  });
});

describe("CUSTOM_API node executor", () => {
  it("throws when secretKey is set but not found in the Secrets Manager, before ever making the request", async () => {
    getSecret.mockResolvedValue(null);
    await expect(CUSTOM_API({ url: "https://example.com/api", secretKey: "missing-key" }, makeContext())).rejects.toThrow(
      /secretKey "missing-key" was not found in this organization's Secrets Manager/,
    );
    expect(performOutgoingRequest).not.toHaveBeenCalled();
  });

  it("injects the resolved secret under the default 'Authorization' header", async () => {
    getSecret.mockResolvedValue("s3cr3t-value");
    await CUSTOM_API({ url: "https://example.com/api", secretKey: "my-key" }, makeContext());
    expect(getSecret).toHaveBeenCalledWith("org_1", "my-key");
    const headers = performOutgoingRequest.mock.calls[0][3] as Record<string, string>;
    expect(headers.Authorization).toBe("s3cr3t-value");
  });

  it("injects the resolved secret under a custom header name when secretHeaderName is set", async () => {
    getSecret.mockResolvedValue("s3cr3t-value");
    await CUSTOM_API({ url: "https://example.com/api", secretKey: "my-key", secretHeaderName: "X-Api-Key" }, makeContext());
    const headers = performOutgoingRequest.mock.calls[0][3] as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("s3cr3t-value");
    expect(headers.Authorization).toBeUndefined();
  });

  it("makes no Secrets Manager lookup at all when secretKey is not set", async () => {
    await CUSTOM_API({ url: "https://example.com/api" }, makeContext());
    expect(getSecret).not.toHaveBeenCalled();
  });
});
