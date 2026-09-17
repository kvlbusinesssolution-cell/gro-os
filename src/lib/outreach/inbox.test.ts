import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing, file-independent next-auth/ESM breakage under Vitest
// documented in reply-actions.test.ts / opportunity-actions.test.ts —
// mocking "@/auth" avoids loading next-auth at all, and revalidatePath()
// needs a Next.js request-scoped store that only exists inside a real
// request/action invocation. Neither module is actually exercised by this
// file (inbox.ts is read-only and has no "use server" directive), but the
// mocks are kept here in case any transitive import pulls them in.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";

import { getInboxThreads, getContactTimeline, getSentEmails, getDraftEmails } from "./inbox";

// Real local-Postgres integration test (no mocking of Prisma), same
// convention as reply-actions.test.ts / opportunity-outreach-actions.test.ts.
// Everything is scoped under two throwaway Organizations created here and
// deleted in afterAll (cascades to Contact/EmailDraft/Reply via
// onDelete: Cascade on organizationId in prisma/schema.prisma).
describe("outreach/inbox", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;

  // Contact A: latest event is a SENT draft after an earlier reply -> read.
  let contactAId: string;
  // Contact B: latest event is a Reply with no later SENT draft -> unread.
  let contactBId: string;
  // Contact C: only ever has a never-sent DRAFT (no SENT draft, no reply).
  let contactCId: string;
  // Contact D: no drafts, no replies at all -> must be excluded entirely.
  let contactDId: string;

  let contactAOldDraftId: string;
  let contactALatestDraftId: string;
  let contactAReplyId: string;
  let contactBLatestReplyId: string;
  let contactCDraftId: string;

  let otherOrgContactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Inbox Test Org", slug: `inbox-test-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Inbox Other Org", slug: `inbox-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Inbox Test User", email: `inbox-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const [contactA, contactB, contactC, contactD, otherOrgContact] = await Promise.all([
      prisma.contact.create({ data: { organizationId: orgId, firstName: "Ava", lastName: "Read", email: `ava-${suffix}@example.com` } }),
      prisma.contact.create({ data: { organizationId: orgId, firstName: "Ben", lastName: "Unread", email: `ben-${suffix}@example.com` } }),
      prisma.contact.create({ data: { organizationId: orgId, firstName: "Cara", lastName: "Draft", email: `cara-${suffix}@example.com` } }),
      prisma.contact.create({ data: { organizationId: orgId, firstName: "Dana", lastName: "None", email: `dana-${suffix}@example.com` } }),
      prisma.contact.create({ data: { organizationId: otherOrgId, firstName: "Other", lastName: "Org", email: `other-${suffix}@example.com` } }),
    ]);
    contactAId = contactA.id;
    contactBId = contactB.id;
    contactCId = contactC.id;
    contactDId = contactD.id;
    otherOrgContactId = otherOrgContact.id;

    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000);

    // Contact A: reply at T-3h, then a SENT draft at T-1h (draft is later -> read, kind SENT).
    // Plus an older SENT draft at T-5h to prove the timeline picks the LATEST sent draft.
    const oldDraftA = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactAId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Old intro",
        body: "This is an old sent email body that should not be the preview.",
        status: "SENT",
        sentAt: hoursAgo(5),
      },
    });
    contactAOldDraftId = oldDraftA.id;

    const replyA = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contactAId,
        channel: "EMAIL",
        content: "Thanks, tell me more",
        loggedByUserId: userId,
        receivedAt: hoursAgo(3),
      },
    });
    contactAReplyId = replyA.id;

    const latestDraftA = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactAId,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        subject: "Here is more detail",
        body: "A".repeat(200), // long body, to test preview truncation to ~120 chars
        status: "SENT",
        sentAt: hoursAgo(1),
      },
    });
    contactALatestDraftId = latestDraftA.id;

    // Contact B: a SENT draft at T-4h, then a reply at T-2h (reply is later -> unread, kind REPLY).
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactBId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Intro to Ben",
        body: "Hello Ben",
        status: "SENT",
        sentAt: hoursAgo(4),
      },
    });
    const latestReplyB = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contactBId,
        channel: "EMAIL",
        content: "I have a question about pricing",
        loggedByUserId: userId,
        receivedAt: hoursAgo(2),
      },
    });
    contactBLatestReplyId = latestReplyB.id;

    // Contact C: only a never-sent DRAFT — no SENT draft, no reply.
    const draftC = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactCId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Unsent draft",
        body: "This draft was never sent.",
        status: "DRAFT",
      },
    });
    contactCDraftId = draftC.id;

    // Cross-org fixture: a Reply that must never leak into orgId's queries.
    await prisma.reply.create({
      data: {
        organizationId: otherOrgId,
        contactId: otherOrgContactId,
        channel: "EMAIL",
        content: "Cross-org reply, should never be visible to orgId",
        loggedByUserId: userId,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const leakedContacts = await prisma.contact.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedContacts).toBe(0);
  });

  describe("getInboxThreads", () => {
    it("includes only contacts with >=1 draft or reply, sorted by most recent event descending, with correct unread flags", async () => {
      const threads = await getInboxThreads(orgId);
      const byContactId = new Map(threads.map((t) => [t.contact.id, t]));

      // Contact D (zero drafts, zero replies) must be excluded entirely.
      expect(byContactId.has(contactDId)).toBe(false);

      // Contact A: latest event is the newer SENT draft -> read, kind SENT, preview from the newer draft.
      const threadA = byContactId.get(contactAId)!;
      expect(threadA).toBeTruthy();
      expect(threadA.unread).toBe(false);
      expect(threadA.lastMessage.kind).toBe("SENT");
      expect(threadA.lastMessage.preview.length).toBeLessThanOrEqual(121);
      expect(threadA.lastMessage.preview.startsWith("A")).toBe(true);

      // Contact B: latest event is the Reply -> unread, kind REPLY.
      const threadB = byContactId.get(contactBId)!;
      expect(threadB).toBeTruthy();
      expect(threadB.unread).toBe(true);
      expect(threadB.lastMessage.kind).toBe("REPLY");

      // Contact C: only a never-sent draft -> included via the documented fallback, not unread.
      const threadC = byContactId.get(contactCId)!;
      expect(threadC).toBeTruthy();
      expect(threadC.unread).toBe(false);

      // Sort order: most recent event first among A/B/C. Contact C's
      // fallback lastMessage uses its draft's createdAt (no sentAt), which
      // is "now" (beforeAll just ran) — i.e. more recent than A's T-1h and
      // B's T-2h fixture timestamps, so C sorts first.
      const orderedIds = threads.filter((t) => [contactAId, contactBId, contactCId].includes(t.contact.id)).map((t) => t.contact.id);
      expect(orderedIds).toEqual([contactCId, contactAId, contactBId]);
    });
  });

  describe("getContactTimeline", () => {
    it("merges drafts (all statuses) and replies ascending by effective timestamp", async () => {
      const timeline = await getContactTimeline(orgId, contactAId);
      expect(timeline).toHaveLength(3);

      const ids = timeline.map((event) => (event.type === "DRAFT" ? event.draft.id : event.reply.id));
      expect(ids).toEqual([contactAOldDraftId, contactAReplyId, contactALatestDraftId]);
      expect(timeline.map((e) => e.type)).toEqual(["DRAFT", "REPLY", "DRAFT"]);
    });

    it("returns [] for a contact belonging to a different organization", async () => {
      const timeline = await getContactTimeline(orgId, otherOrgContactId);
      expect(timeline).toEqual([]);
    });

    it("returns [] for a nonexistent contactId", async () => {
      const timeline = await getContactTimeline(orgId, "nonexistent-contact-id");
      expect(timeline).toEqual([]);
    });
  });

  describe("getSentEmails / getDraftEmails", () => {
    it("getSentEmails returns only SENT drafts for the organization, newest first", async () => {
      const sent = await getSentEmails(orgId);
      expect(sent.every((d) => d.status === "SENT")).toBe(true);
      const ids = sent.map((d) => d.id);
      expect(ids).toContain(contactAOldDraftId);
      expect(ids).toContain(contactALatestDraftId);
      expect(ids).not.toContain(contactCDraftId);

      const indexOfLatest = ids.indexOf(contactALatestDraftId);
      const indexOfOld = ids.indexOf(contactAOldDraftId);
      expect(indexOfLatest).toBeLessThan(indexOfOld);
    });

    it("getDraftEmails returns only DRAFT/PENDING_APPROVAL/APPROVED/QUEUED drafts for the organization", async () => {
      const drafts = await getDraftEmails(orgId);
      const ids = drafts.map((d) => d.id);
      expect(ids).toContain(contactCDraftId);
      expect(ids).not.toContain(contactAOldDraftId);
      expect(ids).not.toContain(contactALatestDraftId);
      expect(drafts.every((d) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"].includes(d.status))).toBe(true);
    });
  });
});
