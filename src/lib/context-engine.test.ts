import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { buildAgentContext, buildGrowthIntelligenceSection } from "./context-engine";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real local-Postgres integration test (no mocking of Prisma), matching the
 * established convention (e.g. src/lib/ai/executive-briefing.test.ts,
 * src/lib/analytics/acquisition-funnel.test.ts).
 *
 * Covers the Phase 10 "War Room grounding" gap: buildGrowthIntelligenceSection
 * is a thin formatter over the real, already-tested computeGrowthSignals()
 * (src/lib/ai/executive-briefing.ts) — this test does not re-derive the
 * underlying numbers, it only proves the section text reflects them
 * honestly, and that buildAgentContext only includes the section for the 5
 * real AI Executive Board agent types.
 */
describe("buildGrowthIntelligenceSection / buildAgentContext growth-intelligence gating (Phase 10)", () => {
  let orgId: string;
  let emptyOrgId: string;
  let userId: string;
  let openStageId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Context Engine Growth Test Org", slug: `context-engine-growth-org-${suffix}` },
    });
    orgId = org.id;

    const emptyOrg = await prisma.organization.create({
      data: { name: "Context Engine Growth Empty Org", slug: `context-engine-growth-empty-org-${suffix}` },
    });
    emptyOrgId = emptyOrg.id;

    const user = await prisma.user.create({
      data: { name: "Context Engine Growth Test User", email: `context-engine-growth-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId, organizationId: emptyOrgId, role: "OWNER", status: "ACTIVE" } });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const openStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Negotiation", order: 0 } });
    openStageId = openStage.id;

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Context Engine Growth Co", source: "LEAD_FINDER" },
    });

    // 2 new LeadOpportunity rows since yesterday, 1 of them HOT.
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

    // 1 real reply since yesterday, INTERESTED.
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Jamie", email: `jamie-context-${suffix}@example.com` },
    });
    const reply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        content: "Sounds interesting, tell me more.",
        intent: "INTERESTED",
        loggedByUserId: userId,
      },
    });
    await prisma.reply.update({ where: { id: reply.id }, data: { receivedAt: new Date() } });

    // 1 real at-risk deal (open, stale updatedAt).
    const atRiskDeal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: openStageId, companyId: company.id, name: "At-risk Deal", value: 5000 },
    });
    await prisma.deal.update({ where: { id: atRiskDeal.id }, data: { updatedAt: new Date(Date.now() - 20 * DAY_MS) } });

    // 1 real pending (SENT) proposal, 5 days old.
    const proposal = await prisma.proposal.create({
      data: { organizationId: orgId, title: "Context Engine Proposal", content: "c", status: "SENT" },
    });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { sentAt: new Date(Date.now() - 5 * DAY_MS) } });

    // 1 real referral-partner candidate.
    await prisma.referralPartner.create({ data: { organizationId: orgId, name: "Context Engine Candidate Partner", status: "CANDIDATE" } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: emptyOrgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("renders the real fixture numbers, never a fabricated figure", async () => {
    const section = await buildGrowthIntelligenceSection(orgId);

    expect(section).not.toBeNull();
    expect(section).toContain("## Real Growth Intelligence");
    expect(section).toContain("2 new opportunity(ies) detected since yesterday");
    expect(section).toContain("1 opportunity(ies) currently at HOT priority");
    expect(section).toContain("INTERESTED: 1");
    expect(section).toContain("1 open deal(s) with no activity in 14+ days");
    expect(section).toContain("1 proposal(s) pending response (oldest: 5 day(s))");
    expect(section).toContain("1 referral-partner candidate(s) awaiting review");
  });

  it("gives honest zero-language for an org with none of this data yet — never a fabricated number", async () => {
    const section = await buildGrowthIntelligenceSection(emptyOrgId);

    expect(section).not.toBeNull();
    expect(section).toContain("No new opportunities detected since yesterday");
    expect(section).toContain("No HOT-priority opportunities on record right now");
    expect(section).toContain("No replies received since yesterday");
    expect(section).toContain("No open deals have gone quiet for 14+ days");
    expect(section).toContain("No proposals are currently pending a response");
    expect(section).toContain("No referral partner candidates awaiting review");
  });

  it("buildAgentContext includes the growth-intelligence section for each of the 5 real Executive Board agent types", async () => {
    for (const agentType of ["CEO", "SALES", "MARKETING", "PROPOSAL", "OUTREACH"] as const) {
      const context = await buildAgentContext(orgId, { agentType });
      expect(context).toContain("## Real Growth Intelligence");
    }
  });

  it("buildAgentContext omits the growth-intelligence section for non-Executive agent types (Delivery/Review board seats)", async () => {
    for (const agentType of ["PROJECT_MANAGER", "QA_DIRECTOR", "FINANCE", "LEGAL", "CRM", "ANALYTICS"] as const) {
      const context = await buildAgentContext(orgId, { agentType });
      expect(context).not.toContain("## Real Growth Intelligence");
    }
  });

  it("buildAgentContext omits the growth-intelligence section when no agentType is passed at all (existing callers unaffected)", async () => {
    const context = await buildAgentContext(orgId, {});
    expect(context).not.toContain("## Real Growth Intelligence");

    // Also exercise the real pre-existing call shape (dealId only, no
    // agentType) to prove this addition is byte-for-byte additive: every
    // caller that never passed agentType keeps behaving exactly as before.
    const withoutAgentType = await buildAgentContext(orgId, { clientQuery: "test" });
    expect(withoutAgentType).not.toContain("## Real Growth Intelligence");
  });
});
