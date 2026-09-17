import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { createDraftFromSuggestedReply } from "./suggested-reply-draft";

// Real local-Postgres integration test (no Prisma mocking), same convention
// as reply-actions.test.ts / opportunity-actions.test.ts. Everything is
// scoped under one throwaway Organization created here and deleted in
// afterAll (cascades to Membership/Contact/Reply/EmailDraft).
describe("suggested-reply-draft", () => {
  let orgId: string;
  let userId: string;
  let contactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Suggested Reply Draft Test Org", slug: `suggested-reply-draft-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "Suggested Reply Test User", email: `suggested-reply-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Riley",
        lastName: "Prospect",
        email: `riley-${suffix}@example.com`,
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });

    const remainingContacts = await prisma.contact.count({ where: { organizationId: orgId } });
    const remainingDrafts = await prisma.emailDraft.count({ where: { organizationId: orgId } });
    const remainingReplies = await prisma.reply.count({ where: { organizationId: orgId } });
    expect(remainingContacts).toBe(0);
    expect(remainingDrafts).toBe(0);
    expect(remainingReplies).toBe(0);
  });

  it("creates a real DRAFT EmailDraft from a Reply's suggestedResponse", async () => {
    const reply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId,
        channel: "EMAIL",
        content: "This looks interesting, can you send over more details on pricing?",
        sentiment: "POSITIVE",
        intent: "PRICE_QUESTION",
        intentConfidence: 0.9,
        suggestedResponse: "Happy to help — here's a quick rundown of pricing for your team size, and I'm glad to jump on a call this week if useful.",
        loggedByUserId: userId,
      },
    });

    const result = await createDraftFromSuggestedReply(reply.id);

    expect(result.ok).toBe(true);
    expect(result.draftId).toBeTruthy();

    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.body).toBe(reply.suggestedResponse);
    expect(draft.contactId).toBe(contactId);
    expect(draft.channel).toBe("EMAIL");
    expect(draft.purpose).toBe("CONVERSATION_SUMMARY");
    expect(draft.trackingToken).toBeTruthy();

    // Calling twice must return the SAME draft, not create a duplicate.
    const secondResult = await createDraftFromSuggestedReply(reply.id);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.draftId).toBe(result.draftId);

    const draftsForContact = await prisma.emailDraft.count({
      where: { contactId, body: reply.suggestedResponse! },
    });
    expect(draftsForContact).toBe(1);
  });

  it("returns an honest error, and creates nothing, when the Reply has no suggestedResponse", async () => {
    const reply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId,
        channel: "EMAIL",
        content: "Out of office until next week.",
        loggedByUserId: userId,
        suggestedResponse: null,
      },
    });

    const result = await createDraftFromSuggestedReply(reply.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no suggested response/i);
    expect(result.draftId).toBeUndefined();

    const draftsForContact = await prisma.emailDraft.count({ where: { contactId } });
    // Only the one draft from the previous test should exist — this call
    // must not have created another.
    expect(draftsForContact).toBe(1);
  });
});
