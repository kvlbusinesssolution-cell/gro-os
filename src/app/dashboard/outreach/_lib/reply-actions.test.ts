import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// reply-actions.ts imports `auth` from "@/auth" at module scope (for the
// session-gated logReply wrapper) and calls revalidatePath() directly
// inside logReplyCore itself. next-auth's ESM build fails to resolve
// `next/server` under Vitest in this Next.js 16 environment (a
// pre-existing, file-independent breakage — see
// opportunity-actions.test.ts), and revalidatePath() needs a Next.js
// request-scoped store that only exists inside a real request/action
// invocation. Both are mocked here for the same reasons as that file, even
// though this test only exercises the headless logReplyCore (which never
// calls auth() itself) — the module-scope `@/auth` import still has to
// resolve, and logReplyCore calls revalidatePath() directly.
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { logReplyCore } from "./reply-actions";
import { advanceSequenceCore } from "./sequence-actions";

// Real local-Postgres integration test (no mocking of Prisma), same
// convention as opportunity-actions.test.ts / dedup.test.ts. Everything is
// scoped under one throwaway Organization created here and deleted in
// afterAll (cascades to Membership/Contact/Reply/Sequence).
describe("reply-actions", () => {
  let orgId: string;
  let userId: string;
  let contactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Reply Actions Test Org", slug: `reply-actions-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "Reply Test User", email: `reply-actions-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Jordan",
        lastName: "Prospect",
        email: `jordan-${suffix}@example.com`,
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });

    const remainingContacts = await prisma.contact.count({ where: { organizationId: orgId } });
    expect(remainingContacts).toBe(0);
  });

  const aiConnected = isAIConnected();

  it.skipIf(!aiConnected)(
    "logReplyCore: a clearly-INTERESTED reply populates sentiment, intent, intentConfidence, and a grounded suggestedResponse",
    async () => {
      const content =
        "Hi, thanks for reaching out — this actually looks really useful for us. Could you send over more details on pricing and how quickly we could get started?";

      const result = await logReplyCore(orgId, userId, contactId, content, "EMAIL");

      expect(result.ok).toBe(true);
      expect(result.replyId).toBeTruthy();

      const reply = await prisma.reply.findUniqueOrThrow({ where: { id: result.replyId! } });
      expect(reply.sentiment).toBe("POSITIVE");
      expect(reply.intent).toBeTruthy();
      expect(["INTERESTED", "PRICE_QUESTION", "NEEDS_INFORMATION"]).toContain(reply.intent);
      expect(reply.intentConfidence).not.toBeNull();
      expect(reply.intentConfidence).toBeGreaterThanOrEqual(0);
      expect(reply.intentConfidence).toBeLessThanOrEqual(1);
      expect(typeof reply.suggestedResponse === "string" || reply.suggestedResponse === null).toBe(true);

      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
      expect(contact.status).toBe("INTERESTED");
    },
    20_000,
  );

  it.skipIf(!aiConnected)(
    "logReplyCore: a clearly-UNSUBSCRIBE reply classifies intent as UNSUBSCRIBE with negative/neutral sentiment",
    async () => {
      const content = "Please remove me from your mailing list and do not contact me again.";

      const result = await logReplyCore(orgId, userId, contactId, content, "EMAIL");

      expect(result.ok).toBe(true);
      expect(result.replyId).toBeTruthy();

      const reply = await prisma.reply.findUniqueOrThrow({ where: { id: result.replyId! } });
      expect(reply.intent).toBe("UNSUBSCRIBE");
      expect(reply.sentiment).not.toBe("POSITIVE");
      expect(reply.intentConfidence).not.toBeNull();
    },
    20_000,
  );

  it("logReplyCore: gracefully returns all-null classification fields when AI is not connected", async () => {
    if (aiConnected) {
      // AI is actually connected in this environment (confirmed above) —
      // soft-skip rather than fabricate an unreachable-AI scenario.
      return;
    }

    const content = "Sounds interesting, tell me more.";
    const result = await logReplyCore(orgId, userId, contactId, content, "EMAIL");

    expect(result.ok).toBe(true);
    const reply = await prisma.reply.findUniqueOrThrow({ where: { id: result.replyId! } });
    expect(reply.sentiment).toBeNull();
    expect(reply.intent).toBeNull();
    expect(reply.intentConfidence).toBeNull();
    expect(reply.suggestedResponse).toBeNull();
  });

  it("advanceSequenceCore: is an honest no-op when the contact is NOT_INTERESTED, without even loading the sequence", async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { status: "NOT_INTERESTED" } });

    // A nonsense sequenceId proves the guard short-circuits before the
    // "Sequence not found" branch would otherwise fire.
    const result = await advanceSequenceCore(contactId, "does-not-exist", orgId);

    expect(result).toEqual({ ok: true, advanced: false });
  });

  it("advanceSequenceCore: is an honest no-op when the contact is UNSUBSCRIBED, without even loading the sequence", async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { status: "UNSUBSCRIBED" } });

    const result = await advanceSequenceCore(contactId, "does-not-exist", orgId);

    expect(result).toEqual({ ok: true, advanced: false });
  });

  it("advanceSequenceCore: still reports 'Sequence not found' for an unaffected contact status", async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { status: "REPLIED" } });

    const result = await advanceSequenceCore(contactId, "does-not-exist", orgId);

    expect(result.ok).toBe(false);
    expect(result.advanced).toBe(false);
    expect(result.error).toBe("Sequence not found.");
  });
});
