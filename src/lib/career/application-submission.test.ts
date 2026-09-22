import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing Vitest/next-auth ESM boilerplate every test that
// transitively imports approval-actions.ts (a "use server" file) needs.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sendQueuedDraftCoreMock } = vi.hoisted(() => ({ sendQueuedDraftCoreMock: vi.fn() }));
vi.mock("@/app/dashboard/outreach/_lib/approval-actions", () => ({ sendQueuedDraftCore: sendQueuedDraftCoreMock }));

import { prisma } from "@/lib/prisma";
import { extractApplicationEmail, determineSubmissionMethod, isRetryableError, submitApplicationViaEmail } from "./application-submission";

describe("extractApplicationEmail — §29 real, bounded extraction (never a guess)", () => {
  it("extracts a real email address explicitly present in the source text", () => {
    expect(extractApplicationEmail("Please apply by sending your resume to jobs@acme.com directly.")).toBe("jobs@acme.com");
  });
  it("returns null when no email address is present — never invents one", () => {
    expect(extractApplicationEmail("Apply through our careers page at acme.com/careers.")).toBeNull();
  });
});

describe("determineSubmissionMethod — §29/§47", () => {
  it("returns EMAIL when a real application email is found in the description", () => {
    const result = determineSubmissionMethod("Send your CV to hiring@acme.com to apply.", null);
    expect(result.method).toBe("EMAIL");
    expect(result.recipientEmail).toBe("hiring@acme.com");
  });

  it("returns USER_ACTION_REQUIRED (honest PLATFORM_RESTRICTED path) when no real channel exists — never fabricates an API/browser method (§47)", () => {
    const result = determineSubmissionMethod("Apply via our external ATS portal.", "https://jobs.example.com/apply/123");
    expect(result.method).toBe("USER_ACTION_REQUIRED");
    expect(result.recipientEmail).toBeNull();
  });
});

describe("isRetryableError — §33 real, bounded retryable classification", () => {
  it("never retries a CAPTCHA/auth/policy failure (§33 explicit non-retryable list)", () => {
    expect(isRetryableError("authentication_required")).toBe(false);
    expect(isRetryableError("captcha")).toBe(false);
    expect(isRetryableError("duplicate")).toBe(false);
    expect(isRetryableError("not_configured")).toBe(false);
    expect(isRetryableError("suppressed")).toBe(false);
    expect(isRetryableError("rate_limited")).toBe(false);
  });
  it("retries a genuinely transient failure", () => {
    expect(isRetryableError("network_timeout")).toBe(true);
    expect(isRetryableError("5xx")).toBe(true);
  });
  it("never retries an unrecognized error kind by default (fail safe, not fail open)", () => {
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("something_new")).toBe(false);
  });
});

describe("submitApplicationViaEmail — §56 mandatory partial-submission scenario", () => {
  let orgId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Submission Test Org", slug: `submission-test-org-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("returns UNCERTAIN (never a clean FAILED, never a false SENT) when the real send call throws mid-flight — e.g. network disconnects after the provider may have already accepted the request", async () => {
    sendQueuedDraftCoreMock.mockRejectedValueOnce(new Error("socket hang up"));

    const result = await submitApplicationViaEmail({
      organizationId: orgId,
      applicationId: "app-1",
      recipientEmail: `recruiter-${Date.now()}@example.com`,
      subject: "Application: Senior React Developer",
      body: "I am applying for this role.",
      candidateUserId: "user-1",
    });

    expect(result.outcome).toBe("UNCERTAIN");
  });

  it("Phase 31 — a real provider TIMEOUT thrown mid-send is treated identically to any other mid-flight exception: UNCERTAIN, never a blind retry, never a false SENT/FAILED", async () => {
    // Real shape a fetch/AbortController timeout actually throws — not a
    // generic Error, to prove the UNCERTAIN path isn't accidentally
    // keyed to a specific Error subclass/message.
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    sendQueuedDraftCoreMock.mockRejectedValueOnce(timeoutError);

    const result = await submitApplicationViaEmail({
      organizationId: orgId,
      applicationId: "app-timeout-1",
      recipientEmail: `recruiter-timeout-${Date.now()}@example.com`,
      subject: "Application: Senior React Developer",
      body: "I am applying for this role.",
      candidateUserId: "user-1",
    });

    expect(result.outcome).toBe("UNCERTAIN");
  });

  it("Phase 31 — a provider response explicitly classified as network_timeout is real, end-to-end retryable via the FAILED path (not just at the isRetryableError unit level)", async () => {
    sendQueuedDraftCoreMock.mockResolvedValueOnce({ ok: false, error: "Provider request timed out.", errorKind: "network_timeout" });

    const result = await submitApplicationViaEmail({
      organizationId: orgId,
      applicationId: "app-timeout-2",
      recipientEmail: `recruiter-timeout2-${Date.now()}@example.com`,
      subject: "Application: Senior React Developer",
      body: "I am applying for this role.",
      candidateUserId: "user-1",
    });

    expect(result.outcome).toBe("FAILED");
    if (result.outcome === "FAILED") expect(result.retryable).toBe(true);
  });

  it("returns SENT with a real providerMessageId when the send genuinely succeeds", async () => {
    sendQueuedDraftCoreMock.mockImplementationOnce(async (organizationId: string, draftId: string) => {
      await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "SENT", sentAt: new Date(), resendMessageId: "resend_msg_real_123" } });
      return { ok: true };
    });

    const result = await submitApplicationViaEmail({
      organizationId: orgId,
      applicationId: "app-2",
      recipientEmail: `recruiter2-${Date.now()}@example.com`,
      subject: "Application: Senior React Developer",
      body: "I am applying for this role.",
      candidateUserId: "user-1",
    });

    expect(result.outcome).toBe("SENT");
    if (result.outcome === "SENT") expect(result.providerMessageId).toBe("resend_msg_real_123");
  });

  it("returns FAILED with a real, honest error when the provider genuinely rejects the send — never claims success", async () => {
    sendQueuedDraftCoreMock.mockResolvedValueOnce({ ok: false, error: "Provider rejected the send.", errorKind: "generic" });

    const result = await submitApplicationViaEmail({
      organizationId: orgId,
      applicationId: "app-3",
      recipientEmail: `recruiter3-${Date.now()}@example.com`,
      subject: "Application: Senior React Developer",
      body: "I am applying for this role.",
      candidateUserId: "user-1",
    });

    expect(result.outcome).toBe("FAILED");
  });

  it("reuses an existing Contact for the same real recipient email rather than creating a duplicate", async () => {
    const email = `reuse-${Date.now()}@example.com`;
    sendQueuedDraftCoreMock.mockResolvedValue({ ok: true });

    await submitApplicationViaEmail({ organizationId: orgId, applicationId: "app-4a", recipientEmail: email, subject: "s", body: "b", candidateUserId: "user-1" });
    await submitApplicationViaEmail({ organizationId: orgId, applicationId: "app-4b", recipientEmail: email, subject: "s", body: "b", candidateUserId: "user-1" });

    const contacts = await prisma.contact.findMany({ where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } } });
    expect(contacts).toHaveLength(1);
  });
});
