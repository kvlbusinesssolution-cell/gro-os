import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { getTodaysClientConversations } from "./todays-client-conversations";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real local-Postgres integration test (no mocking of Prisma), matching the
 * established convention (e.g. src/lib/ai/daily-action-center.test.ts).
 *
 * Two throwaway organizations:
 *   - `orgId` — has a contact with real TODAY activity (a sent email) and a
 *     second contact with only OLD activity (a reply from 3 days ago),
 *     proving only the former appears.
 *   - `otherOrgId` — genuinely has today's activity for its own contact,
 *     proving tenant isolation: `orgId`'s query never sees it and vice versa.
 */
describe("getTodaysClientConversations", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let todaysContactId: string;
  let oldContactId: string;
  let otherOrgContactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Todays Conversations Test Org", slug: `todays-conversations-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Todays Conversations Other Test Org", slug: `todays-conversations-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Todays Conversations Test User", email: `todays-conversations-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId, organizationId: otherOrgId, role: "OWNER", status: "ACTIVE" } });

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Todays Conversations Co", source: "LEAD_FINDER" },
    });
    const otherCompany = await prisma.company.create({
      data: { organizationId: otherOrgId, name: "Other Org Co", source: "LEAD_FINDER" },
    });

    // ===== Contact with real TODAY activity (a sent email today) =====
    const todaysContact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId: company.id,
        firstName: "Today",
        lastName: "Contact",
        email: `today-contact-${suffix}@example.com`,
      },
    });
    todaysContactId = todaysContact.id;
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: todaysContactId,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        body: "Sent today",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "SEO",
        title: "Real opportunity for today's contact",
        description: "d",
        estimatedImpact: "high",
        evidence: "e",
        confidenceScore: 90,
      },
    });

    // ===== Contact with only OLD activity (a reply 3 days ago) — must NOT appear =====
    const oldContact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId: company.id,
        firstName: "Old",
        lastName: "Contact",
        email: `old-contact-${suffix}@example.com`,
      },
    });
    oldContactId = oldContact.id;
    await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: oldContactId,
        channel: "EMAIL",
        content: "This reply is old",
        intent: "INTERESTED",
        loggedByUserId: userId,
        receivedAt: new Date(Date.now() - 3 * DAY_MS),
      },
    });

    // ===== Other org's own contact with TODAY activity — must never leak into orgId's results =====
    const otherOrgContact = await prisma.contact.create({
      data: {
        organizationId: otherOrgId,
        companyId: otherCompany.id,
        firstName: "OtherOrg",
        lastName: "Contact",
        email: `other-org-contact-${suffix}@example.com`,
      },
    });
    otherOrgContactId = otherOrgContact.id;
    await prisma.reply.create({
      data: {
        organizationId: otherOrgId,
        contactId: otherOrgContactId,
        channel: "EMAIL",
        content: "Other org's own today reply",
        intent: "REQUEST_PROPOSAL",
        loggedByUserId: userId,
        receivedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("includes a contact with today's activity, with its real opportunity attached", async () => {
    const rows = await getTodaysClientConversations(orgId);
    const row = rows.find((r) => r.contact.id === todaysContactId);
    expect(row).toBeDefined();
    expect(row!.lastEmailAt).not.toBeNull();
    expect(row!.opportunity?.title).toBe("Real opportunity for today's contact");
  });

  it("excludes a contact whose only activity is old", async () => {
    const rows = await getTodaysClientConversations(orgId);
    expect(rows.find((r) => r.contact.id === oldContactId)).toBeUndefined();
  });

  it("enforces tenant isolation — orgId never sees the other org's today activity, and vice versa", async () => {
    const rows = await getTodaysClientConversations(orgId);
    expect(rows.find((r) => r.contact.id === otherOrgContactId)).toBeUndefined();

    const otherRows = await getTodaysClientConversations(otherOrgId);
    expect(otherRows.find((r) => r.contact.id === otherOrgContactId)).toBeDefined();
    expect(otherRows.find((r) => r.contact.id === todaysContactId)).toBeUndefined();
    expect(otherRows.find((r) => r.contact.id === oldContactId)).toBeUndefined();
  });
});
