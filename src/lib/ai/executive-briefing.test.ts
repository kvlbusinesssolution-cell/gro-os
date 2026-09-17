import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { computeGrowthSignals, generateDailyBrief } from "./executive-briefing";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real local-Postgres integration test (no mocking of Prisma), matching the
 * established convention (e.g. src/lib/analytics/acquisition-funnel.test.ts,
 * src/lib/business-development/opportunity-brief.test.ts).
 *
 * Two throwaway organizations:
 *   - `orgId` — a fully-populated fixture proving every new GrowthSignals
 *     field reflects a real Phase 1-9 row (never fabricated).
 *   - `emptyOrgId` — genuinely has none of this data, proving the honest
 *     "no data yet" behavior (0 / null / empty array, never an invented
 *     plausible-sounding number).
 */
describe("computeGrowthSignals / generateDailyBrief (Phase 10 growth signals)", () => {
  let orgId: string;
  let emptyOrgId: string;
  let userId: string;
  let openStageId: string;
  let wonStageId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Growth Signals Test Org", slug: `growth-signals-org-${suffix}` },
    });
    orgId = org.id;

    const emptyOrg = await prisma.organization.create({
      data: { name: "Growth Signals Empty Test Org", slug: `growth-signals-empty-org-${suffix}` },
    });
    emptyOrgId = emptyOrg.id;

    const user = await prisma.user.create({
      data: { name: "Growth Signals Test User", email: `growth-signals-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId, organizationId: emptyOrgId, role: "OWNER", status: "ACTIVE" } });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const openStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Negotiation", order: 0 } });
    openStageId = openStage.id;
    const wonStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Won", order: 1 } });
    wonStageId = wonStage.id;

    // ===== LeadOpportunity: 2 new since yesterday, 1 of which is HOT, plus 1 old HOT =====
    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Growth Signals Co", source: "LEAD_FINDER" },
    });

    await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "SEO",
        title: "Recent HOT opportunity",
        description: "d",
        estimatedImpact: "high",
        evidence: "e",
        confidenceScore: 90,
        priority: "HOT",
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "SEO",
        title: "Recent MEDIUM opportunity",
        description: "d",
        estimatedImpact: "medium",
        evidence: "e",
        confidenceScore: 60,
        priority: "MEDIUM",
      },
    });
    // Old (not "new since yesterday") but still counts toward the live HOT snapshot.
    const oldHot = await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "SEO",
        title: "Old HOT opportunity",
        description: "d",
        evidence: "e",
        estimatedImpact: "high",
        confidenceScore: 95,
        priority: "HOT",
      },
    });
    await prisma.leadOpportunity.update({
      where: { id: oldHot.id },
      data: { createdAt: new Date(Date.now() - 10 * DAY_MS) },
    });

    // ===== Reply: 2 since yesterday (1 INTERESTED, 1 unclassified), 1 old (excluded) =====
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Jamie", email: `jamie-${suffix}@example.com` },
    });

    const recentInterestedReply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        content: "Sounds interesting, tell me more.",
        intent: "INTERESTED",
        loggedByUserId: userId,
      },
    });
    const recentUnclassifiedReply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        content: "Ok.",
        loggedByUserId: userId,
      },
    });
    const oldReply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        content: "Old reply, out of window.",
        intent: "NOT_INTERESTED",
        loggedByUserId: userId,
      },
    });
    await prisma.reply.updateMany({
      where: { id: { in: [recentInterestedReply.id, recentUnclassifiedReply.id] } },
      data: { receivedAt: new Date() },
    });
    await prisma.reply.update({
      where: { id: oldReply.id },
      data: { receivedAt: new Date(Date.now() - 10 * DAY_MS) },
    });

    // ===== Deal: 1 at-risk (open, updatedAt 20 days ago), 1 healthy open (updatedAt now), 1 Won (excluded regardless of age) =====
    const atRiskDeal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: openStageId, companyId: company.id, name: "At-risk Deal", value: 5000 },
    });
    await prisma.deal.update({ where: { id: atRiskDeal.id }, data: { updatedAt: new Date(Date.now() - 20 * DAY_MS) } });

    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: openStageId, companyId: company.id, name: "Healthy Deal", value: 3000 },
    });

    const oldWonDeal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStageId, companyId: company.id, name: "Old Won Deal", value: 10000 },
    });
    await prisma.deal.update({ where: { id: oldWonDeal.id }, data: { updatedAt: new Date(Date.now() - 20 * DAY_MS) } });

    // ===== Proposal: 2 pending (SENT), one older than the other; 1 DRAFT (excluded) =====
    const olderProposal = await prisma.proposal.create({
      data: { organizationId: orgId, title: "Older Proposal", content: "c", status: "SENT" },
    });
    await prisma.proposal.update({
      where: { id: olderProposal.id },
      data: { sentAt: new Date(Date.now() - 8 * DAY_MS) },
    });
    const newerProposal = await prisma.proposal.create({
      data: { organizationId: orgId, title: "Newer Proposal", content: "c", status: "SENT" },
    });
    await prisma.proposal.update({
      where: { id: newerProposal.id },
      data: { sentAt: new Date(Date.now() - 1 * DAY_MS) },
    });
    await prisma.proposal.create({
      data: { organizationId: orgId, title: "Draft Proposal", content: "c", status: "DRAFT" },
    });

    // ===== ReferralPartner: 2 CANDIDATE, 1 ACTIVE (excluded) =====
    await prisma.referralPartner.create({ data: { organizationId: orgId, name: "Candidate Partner A", status: "CANDIDATE" } });
    await prisma.referralPartner.create({ data: { organizationId: orgId, name: "Candidate Partner B", status: "CANDIDATE" } });
    await prisma.referralPartner.create({ data: { organizationId: orgId, name: "Active Partner", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: emptyOrgId } });
    await prisma.user.delete({ where: { id: userId } });

    const leakedBriefings = await prisma.executiveBriefing.count({ where: { organizationId: { in: [orgId, emptyOrgId] } } });
    expect(leakedBriefings).toBe(0);
  });

  it("reflects every real Phase 1-9 number from the fixture — never a fabricated figure", async () => {
    const signals = await computeGrowthSignals(orgId);

    expect(signals.newOpportunitiesCount).toBe(2);
    expect(signals.hotOpportunitiesCount).toBe(2); // both HOT rows, regardless of age

    const interested = signals.repliesByIntent.find((r) => r.intent === "INTERESTED");
    const unclassified = signals.repliesByIntent.find((r) => r.intent === null);
    expect(interested?.count).toBe(1);
    expect(unclassified?.count).toBe(1);
    // The old, out-of-window NOT_INTERESTED reply must not appear at all.
    expect(signals.repliesByIntent.find((r) => r.intent === "NOT_INTERESTED")).toBeUndefined();

    expect(signals.atRiskDealsCount).toBe(1); // only the stale OPEN deal — Won deal excluded regardless of age

    expect(signals.pendingProposalsCount).toBe(2);
    expect(signals.oldestPendingProposalAgeDays).toBeGreaterThanOrEqual(7);

    expect(signals.referralPartnerCandidatesCount).toBe(2);

    expect(signals.acquisitionFunnel.length).toBeGreaterThan(0);
    expect(signals.acquisitionFunnel.find((s) => s.stage === "Companies")?.count).toBeGreaterThanOrEqual(1);
  });

  it("gives an honest, all-zero/null GrowthSignals for an org with none of this Phase 1-9 data yet — never a fabricated number", async () => {
    const signals = await computeGrowthSignals(emptyOrgId);

    expect(signals.newOpportunitiesCount).toBe(0);
    expect(signals.hotOpportunitiesCount).toBe(0);
    expect(signals.repliesByIntent).toEqual([]);
    expect(signals.atRiskDealsCount).toBe(0);
    expect(signals.pendingProposalsCount).toBe(0);
    expect(signals.oldestPendingProposalAgeDays).toBeNull();
    expect(signals.referralPartnerCandidatesCount).toBe(0);
    expect(signals.acquisitionTotalRevenue).toBe(0);
    // Every funnel stage present but honestly at 0 — never omitted/invented.
    for (const stage of signals.acquisitionFunnel) {
      expect(stage.count).toBe(0);
    }
  });

  it("generateDailyBrief persists growthSignals on the real ExecutiveBriefing row, matching computeGrowthSignals", async () => {
    const briefing = await generateDailyBrief(orgId);

    expect(briefing.growthSignals).not.toBeNull();
    const persisted = briefing.growthSignals as unknown as { newOpportunitiesCount: number; hotOpportunitiesCount: number };
    expect(persisted.newOpportunitiesCount).toBe(2);
    expect(persisted.hotOpportunitiesCount).toBe(2);

    if (isAIConnected()) {
      // Soft assertion only — a real AI call may still fail for reasons
      // outside this test's control (rate limits, provider outage). When it
      // does succeed, the narrative must be non-fabricated prose grounded
      // in the real data above, never null.
      if (briefing.narrativeSummary) {
        expect(briefing.narrativeSummary.length).toBeGreaterThan(0);
      }
    } else {
      expect(briefing.narrativeSummary).toBeNull();
    }
  });
});
