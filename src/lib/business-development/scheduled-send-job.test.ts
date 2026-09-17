import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing next-auth/ESM breakage under Vitest that every other
// Server-Action integration test in this repo mocks around (see
// compose-actions.test.ts) — runScheduledEmailSend transitively imports
// approval-actions.ts (for sendQueuedDraftCore), which imports `auth` at
// module scope and calls revalidatePath(), which needs a real Next.js
// request-scoped store that only exists inside an actual request/action
// invocation.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// This environment has real RESEND_API_KEY/EMAIL_SERVER credentials
// configured (see .env), so sendOutreachEmail would otherwise make a real
// network call to Resend — which then genuinely rejects `to` addresses on
// non-allowlisted domains like example.com. Same "simulate send" boundary
// phase3-email-center.e2e.test.ts uses (it flips status to SENT directly
// rather than exercising the real provider network call): mock only the
// network-touching sendOutreachEmail, so runScheduledEmailSend/
// sendQueuedDraftCore's own real orchestration logic (the thing actually
// under test here — promote to QUEUED, re-check unsubscribe, call the send
// function, persist SENT/FAILED) still runs for real and unmocked.
vi.mock("@/lib/outreach/email-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/outreach/email-provider")>();
  return { ...actual, sendOutreachEmail: vi.fn() };
});

import { prisma } from "@/lib/prisma";
import { sendOutreachEmail } from "@/lib/outreach/email-provider";

import { runScheduledEmailSend } from "./scheduled-send-job";
import { cancelScheduledEmailCore } from "@/app/dashboard/outreach/_lib/compose-actions";

const sendOutreachEmailMock = vi.mocked(sendOutreachEmail);

/**
 * Real local-Postgres integration test (no mocking of Prisma), same
 * convention as compose-actions.test.ts / phase3-email-center.e2e.test.ts.
 * Everything lives under one throwaway Organization created here and
 * deleted in afterAll (cascades to Contact/EmailDraft via onDelete: Cascade
 * on organizationId).
 */
describe("scheduled-send-job", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  const suffix = Date.now();

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Scheduled Send Test Org", slug: `scheduled-send-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Scheduled Send Other Org", slug: `scheduled-send-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Scheduled Send Test User", email: `scheduled-send-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });
  });

  async function createContact(overrides?: Partial<{ status: "NEW" | "UNSUBSCRIBED"; organizationId: string }>) {
    return prisma.contact.create({
      data: {
        organizationId: overrides?.organizationId ?? orgId,
        firstName: "Test",
        lastName: "Contact",
        email: `contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        status: overrides?.status ?? "NEW",
      },
    });
  }

  async function createScheduledDraft(contactId: string, scheduledFor: Date, organizationId = orgId) {
    return prisma.emailDraft.create({
      data: {
        organizationId,
        contactId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "A scheduled subject",
        body: "A scheduled body.",
        status: "APPROVED",
        scheduledFor,
      },
    });
  }

  it("sends a due scheduled draft through the real send pipeline (sendQueuedDraftCore), never a duplicate one", async () => {
    // resendMessageId is a real @unique column — a literal reused across
    // tests/rows would itself throw a genuine unique-constraint error, so
    // every mocked send gets its own real-looking unique id.
    sendOutreachEmailMock.mockResolvedValueOnce({ ok: true, providerMessageId: `test-provider-message-id-${Date.now()}-${Math.random()}` });

    const contact = await createContact();
    const due = new Date(Date.now() - 60_000);
    const draft = await createScheduledDraft(contact.id, due);

    const logs = await runScheduledEmailSend();

    const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    // Always promoted through QUEUED (the real transition the scheduledFor
    // schema comment documents) on its way to SENT.
    expect(updated.queuedAt).not.toBeNull();
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).not.toBeNull();

    // sendOutreachEmail — the one real network-touching function — was
    // actually invoked, with this exact draft's real recipient/subject/body,
    // proving the job went through the real send pipeline rather than
    // faking a SENT status.
    expect(sendOutreachEmailMock).toHaveBeenCalledWith(
      draft.organizationId,
      expect.objectContaining({ to: contact.email, subject: draft.subject }),
    );

    expect(logs.some((l) => l.message.includes(draft.id))).toBe(true);
  });

  it("marks a due draft FAILED (never SENT) when the real send provider genuinely fails", async () => {
    sendOutreachEmailMock.mockResolvedValueOnce({ ok: false, errorKind: "failed", error: "Provider rejected the send." });

    const contact = await createContact();
    const due = new Date(Date.now() - 60_000);
    const draft = await createScheduledDraft(contact.id, due);

    await runScheduledEmailSend();

    const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.failedReason).toBe("Provider rejected the send.");
    expect(updated.sentAt).toBeNull();
  });

  it("leaves a not-yet-due scheduled draft untouched", async () => {
    const contact = await createContact();
    const notYetDue = new Date(Date.now() + 60 * 60 * 1000);
    const draft = await createScheduledDraft(contact.id, notYetDue);

    await runScheduledEmailSend();

    const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.status).toBe("APPROVED");
    expect(updated.queuedAt).toBeNull();
    expect(updated.scheduledFor?.getTime()).toBe(notYetDue.getTime());
  });

  it("fails (never sends) a due draft whose contact unsubscribed after it was scheduled", async () => {
    const contact = await createContact({ status: "UNSUBSCRIBED" });
    const due = new Date(Date.now() - 60_000);
    const draft = await createScheduledDraft(contact.id, due);

    const logs = await runScheduledEmailSend();

    const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.failedReason).toContain("unsubscribed");
    // Never even promoted to QUEUED — it was never actually about to be sent.
    expect(updated.queuedAt).toBeNull();
    expect(updated.sentAt).toBeNull();
    expect(logs.some((l) => l.message.includes("unsubscribed"))).toBe(true);
  });

  it("processes multiple due drafts independently — one failure doesn't block the rest", async () => {
    sendOutreachEmailMock.mockResolvedValueOnce({ ok: true, providerMessageId: `test-provider-message-id-${Date.now()}-${Math.random()}` });

    const okContact = await createContact();
    const unsubContact = await createContact({ status: "UNSUBSCRIBED" });
    const due = new Date(Date.now() - 60_000);
    const okDraft = await createScheduledDraft(okContact.id, due);
    const failDraft = await createScheduledDraft(unsubContact.id, due);

    await runScheduledEmailSend();

    const okUpdated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: okDraft.id } });
    const failUpdated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: failDraft.id } });
    expect(okUpdated.status).toBe("SENT");
    expect(failUpdated.status).toBe("FAILED");
  });

  describe("cancelScheduledEmailCore", () => {
    it("clears scheduledFor on a still-APPROVED scheduled draft, keeping it APPROVED", async () => {
      const contact = await createContact();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const draft = await createScheduledDraft(contact.id, future);

      const result = await cancelScheduledEmailCore(orgId, userId, draft.id);
      expect(result.ok).toBe(true);

      const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
      expect(updated.scheduledFor).toBeNull();
      expect(updated.status).toBe("APPROVED");
    });

    it("rejects a draft belonging to a different organization", async () => {
      const contact = await createContact({ organizationId: otherOrgId });
      const future = new Date(Date.now() + 60 * 60 * 1000);
      const draft = await createScheduledDraft(contact.id, future, otherOrgId);

      const result = await cancelScheduledEmailCore(orgId, userId, draft.id);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Draft not found.");

      const unchanged = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
      expect(unchanged.scheduledFor?.getTime()).toBe(future.getTime());
    });

    it("rejects an already-sent draft", async () => {
      const contact = await createContact();
      const draft = await prisma.emailDraft.create({
        data: {
          organizationId: orgId,
          contactId: contact.id,
          channel: "EMAIL",
          purpose: "INTRODUCTION",
          tone: "PROFESSIONAL",
          subject: "Already sent",
          body: "Body.",
          status: "SENT",
          scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
          sentAt: new Date(),
        },
      });

      const result = await cancelScheduledEmailCore(orgId, userId, draft.id);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("already been queued or sent");
    });

    it("rejects a draft that was never scheduled", async () => {
      const contact = await createContact();
      const draft = await prisma.emailDraft.create({
        data: {
          organizationId: orgId,
          contactId: contact.id,
          channel: "EMAIL",
          purpose: "INTRODUCTION",
          tone: "PROFESSIONAL",
          subject: "Never scheduled",
          body: "Body.",
          status: "APPROVED",
        },
      });

      const result = await cancelScheduledEmailCore(orgId, userId, draft.id);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("This draft isn't scheduled.");
    });
  });
});
