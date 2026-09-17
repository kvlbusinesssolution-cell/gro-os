import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { computeTodaysActions } from "./daily-action-center";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real local-Postgres integration test (no mocking of Prisma), matching the
 * established convention (e.g. src/lib/ai/executive-briefing.test.ts,
 * src/lib/analytics/acquisition-funnel.test.ts).
 *
 * Two throwaway organizations:
 *   - `orgId` — a fully-populated fixture proving every TodaysActionItem
 *     count reflects real, hand-counted Phase 1-9/ActionItem rows.
 *   - `emptyOrgId` — genuinely has none of this data, proving the honest
 *     "nothing to show" behavior (an empty array, never a fabricated
 *     placeholder item).
 */
describe("computeTodaysActions (Phase 10 Daily Action Center)", () => {
  let orgId: string;
  let emptyOrgId: string;
  let userId: string;
  let openStageId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Daily Action Center Test Org", slug: `daily-action-center-org-${suffix}` },
    });
    orgId = org.id;

    const emptyOrg = await prisma.organization.create({
      data: { name: "Daily Action Center Empty Test Org", slug: `daily-action-center-empty-org-${suffix}` },
    });
    emptyOrgId = emptyOrg.id;

    const user = await prisma.user.create({
      data: { name: "Daily Action Center Test User", email: `daily-action-center-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId, organizationId: emptyOrgId, role: "OWNER", status: "ACTIVE" } });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const openStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Negotiation", order: 0 } });
    openStageId = openStage.id;
    const wonStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Won", order: 1 } });

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Daily Action Center Co", source: "LEAD_FINDER" },
    });

    // ===== ActionItem: 2 due today-or-earlier and open, 1 due tomorrow (excluded), 1 overdue but DONE (excluded) =====
    await prisma.actionItem.create({
      data: { organizationId: orgId, title: "Due today, open", status: "OPEN", dueDate: new Date() },
    });
    await prisma.actionItem.create({
      data: {
        organizationId: orgId,
        title: "Overdue, in progress",
        status: "IN_PROGRESS",
        dueDate: new Date(Date.now() - 3 * DAY_MS),
      },
    });
    await prisma.actionItem.create({
      data: {
        organizationId: orgId,
        title: "Due tomorrow, open (not yet due)",
        status: "OPEN",
        dueDate: new Date(Date.now() + 1 * DAY_MS),
      },
    });
    await prisma.actionItem.create({
      data: {
        organizationId: orgId,
        title: "Overdue but already done",
        status: "DONE",
        dueDate: new Date(Date.now() - 5 * DAY_MS),
      },
    });
    await prisma.actionItem.create({
      data: { organizationId: orgId, title: "No due date, open", status: "OPEN", dueDate: null },
    });

    // ===== Proposal: 3 SENT (pending), 1 DRAFT (excluded) =====
    await prisma.proposal.create({ data: { organizationId: orgId, title: "Sent Proposal A", content: "c", status: "SENT" } });
    await prisma.proposal.create({ data: { organizationId: orgId, title: "Sent Proposal B", content: "c", status: "SENT" } });
    await prisma.proposal.create({ data: { organizationId: orgId, title: "Sent Proposal C", content: "c", status: "SENT" } });
    await prisma.proposal.create({ data: { organizationId: orgId, title: "Draft Proposal", content: "c", status: "DRAFT" } });

    // ===== LeadOpportunity: 5 HOT, 1 MEDIUM (excluded) =====
    for (let i = 0; i < 5; i++) {
      await prisma.leadOpportunity.create({
        data: {
          companyId: company.id,
          category: "SEO",
          title: `HOT opportunity ${i}`,
          description: "d",
          estimatedImpact: "high",
          evidence: "e",
          confidenceScore: 90,
          priority: "HOT",
        },
      });
    }
    await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "SEO",
        title: "MEDIUM opportunity",
        description: "d",
        estimatedImpact: "medium",
        evidence: "e",
        confidenceScore: 60,
        priority: "MEDIUM",
      },
    });

    // ===== EmailDraft: 8 PENDING_APPROVAL, 1 DRAFT + 1 SENT (excluded) =====
    const contactForDrafts = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Drafts", email: `drafts-${suffix}@example.com` },
    });
    for (let i = 0; i < 8; i++) {
      await prisma.emailDraft.create({
        data: {
          organizationId: orgId,
          contactId: contactForDrafts.id,
          channel: "EMAIL",
          purpose: "FOLLOW_UP",
          tone: "PROFESSIONAL",
          body: `Draft body ${i}`,
          status: "PENDING_APPROVAL",
        },
      });
    }
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactForDrafts.id,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        body: "Still a draft",
        status: "DRAFT",
      },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contactForDrafts.id,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        body: "Already sent",
        status: "SENT",
      },
    });

    // ===== Reply (REQUEST_CALL): 2 distinct contacts with no Task yet, 1 contact already has a Task (excluded) =====
    const readyContactA = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "ReadyA", email: `ready-a-${suffix}@example.com` },
    });
    const readyContactB = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "ReadyB", email: `ready-b-${suffix}@example.com` },
    });
    const alreadyTrackedContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Tracked", email: `tracked-${suffix}@example.com` },
    });

    await prisma.reply.create({
      data: { organizationId: orgId, contactId: readyContactA.id, channel: "EMAIL", content: "Call me", intent: "REQUEST_CALL", loggedByUserId: userId },
    });
    await prisma.reply.create({
      data: { organizationId: orgId, contactId: readyContactB.id, channel: "EMAIL", content: "Let's talk", intent: "REQUEST_CALL", loggedByUserId: userId },
    });
    await prisma.reply.create({
      data: { organizationId: orgId, contactId: alreadyTrackedContact.id, channel: "EMAIL", content: "Ring me up", intent: "REQUEST_CALL", loggedByUserId: userId },
    });
    // A non-REQUEST_CALL reply must never be counted.
    await prisma.reply.create({
      data: { organizationId: orgId, contactId: readyContactA.id, channel: "EMAIL", content: "Not interested", intent: "NOT_INTERESTED", loggedByUserId: userId },
    });

    await prisma.task.create({
      data: {
        organizationId: orgId,
        contactId: alreadyTrackedContact.id,
        title: "Already following up with Tracked contact",
      },
    });

    // ===== Deal: 1 at-risk (open, stale), 1 healthy open, 1 Won (excluded regardless of age) =====
    const atRiskDeal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: openStageId, companyId: company.id, name: "At-risk Deal", value: 5000 },
    });
    await prisma.deal.update({ where: { id: atRiskDeal.id }, data: { updatedAt: new Date(Date.now() - 20 * DAY_MS) } });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: openStageId, companyId: company.id, name: "Healthy Deal", value: 3000 },
    });
    const oldWonDeal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStage.id, companyId: company.id, name: "Old Won Deal", value: 10000 },
    });
    await prisma.deal.update({ where: { id: oldWonDeal.id }, data: { updatedAt: new Date(Date.now() - 20 * DAY_MS) } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: emptyOrgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns precisely hand-counted numbers for every real Phase 1-9/ActionItem row — never a fabricated figure", async () => {
    const actions = await computeTodaysActions(orgId);
    const byHref = new Map(actions.map((a) => [a.href, a]));

    expect(byHref.get("/board/action-items")?.count).toBe(2);
    expect(byHref.get("/dashboard/proposal/proposals")?.count).toBe(3);
    expect(byHref.get("/dashboard/priority-queue?priority=HOT")?.count).toBe(5);
    expect(byHref.get("/dashboard/outreach")?.count).toBe(8);
    expect(byHref.get("/dashboard/outreach/contacts")?.count).toBe(2);
    expect(byHref.get("/dashboard/crm/deals")?.count).toBe(1);

    expect(actions).toHaveLength(6);
    for (const action of actions) {
      expect(action.count).toBeGreaterThan(0);
    }
  });

  it("returns an empty list for an org with none of this data yet — never a fabricated placeholder item", async () => {
    const actions = await computeTodaysActions(emptyOrgId);
    expect(actions).toEqual([]);
  });
});
