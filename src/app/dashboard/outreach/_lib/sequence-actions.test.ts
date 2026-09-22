import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// sequence-actions.ts imports `auth` from "@/auth" at module scope and
// calls revalidatePath() inside advanceSequenceCore itself — same
// pre-existing, file-independent Vitest/next-auth ESM breakage documented
// in reply-actions.test.ts and opportunity-actions.test.ts. Mocked here for
// the same reason, even though this test only exercises the headless
// advanceSequenceCore (which never calls auth() itself).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import type { ContactStatus } from "@/generated/prisma/client";

import { advanceSequenceCore } from "./sequence-actions";

/**
 * Phase 17 (Advanced Outbound + Email Deliverability) — real local-Postgres
 * integration test (same convention as reply-automation.test.ts) covering
 * the real bug this phase fixed: advanceSequenceCore used to only stop a
 * sequence for NOT_INTERESTED/UNSUBSCRIBED, silently sending the next
 * canned follow-up to a contact who had genuinely REPLIED, gone
 * INTERESTED, or already booked a meeting.
 */
describe("advanceSequenceCore — real reply/engagement stops the sequence", () => {
  const aiConnected = isAIConnected();
  let orgId: string;
  let userId: string;
  let companyId: string;
  let sequenceId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Sequence Stop Test Org", slug: `sequence-stop-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Sequence Stop Test User", email: `sequence-stop-user-${suffix}@example.com` } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    const company = await prisma.company.create({ data: { organizationId: orgId, name: "Sequence Stop Test Co", status: "PROSPECT" } });
    companyId = company.id;

    const sequence = await prisma.sequence.create({
      data: {
        organizationId: orgId,
        name: "Two-step test sequence",
        steps: [
          { order: 0, type: "EMAIL", delayDays: 0 },
          { order: 1, type: "EMAIL", delayDays: 0, purpose: "FOLLOW_UP" },
        ],
      },
    });
    sequenceId = sequence.id;
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  async function makeContactWithSentStep(status: ContactStatus, suffix: string) {
    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "Test",
        lastName: suffix,
        email: `sequence-stop-${suffix}-${Date.now()}@example.com`,
        ownerUserId: userId,
        status,
      },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        sequenceId,
        sequenceStepIndex: 0,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Step 1",
        body: "Step 1 body.",
        status: "SENT",
        sentAt: new Date(Date.now() - 86_400_000), // sent yesterday — any delayDays=0 next step is due
      },
    });
    return contact;
  }

  const STOP_STATUSES: ContactStatus[] = ["REPLIED", "INTERESTED", "NOT_INTERESTED", "MEETING_BOOKED", "UNSUBSCRIBED"];

  for (const status of STOP_STATUSES) {
    it(`does not advance and reports a real stoppedReason when contact status is ${status}`, async () => {
      const contact = await makeContactWithSentStep(status, status.toLowerCase());
      const result = await advanceSequenceCore(contact.id, sequenceId, orgId);
      expect(result.ok).toBe(true);
      expect(result.advanced).toBe(false);
      expect(result.stoppedReason).toContain(status);

      // Real proof, not just the return value: no second EmailDraft was created for this contact.
      const drafts = await prisma.emailDraft.count({ where: { contactId: contact.id, sequenceId } });
      expect(drafts).toBe(1);
    });
  }

  it.skipIf(!aiConnected)("advances a NEW-status contact whose prior step is SENT and due — never blocked by a status it shouldn't stop on", async () => {
    const contact = await makeContactWithSentStep("NEW", "new-continues");
    const result = await advanceSequenceCore(contact.id, sequenceId, orgId);
    expect(result.ok).toBe(true);
    expect(result.advanced).toBe(true);
    expect(result.stoppedReason).toBeUndefined();

    const drafts = await prisma.emailDraft.count({ where: { contactId: contact.id, sequenceId } });
    expect(drafts).toBe(2);
  });

  it("CONTACTED-status contact is a real non-stop status too (only the 5 real stop statuses halt the sequence)", async () => {
    if (!aiConnected) return; // same AI-dependent path as the NEW case above
    const contact = await makeContactWithSentStep("CONTACTED", "contacted-continues");
    const result = await advanceSequenceCore(contact.id, sequenceId, orgId);
    expect(result.advanced).toBe(true);
  });
});
