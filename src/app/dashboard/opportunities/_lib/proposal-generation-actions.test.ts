import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same next-auth/next-cache stubbing every other "use server" action test in
// this repo needs (see opportunity-actions.test.ts's comment) — this test
// only exercises the headless *Core function, which never calls auth() or
// revalidatePath()'s request-scoped store.
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { generateProposalFromOpportunityCore } from "./proposal-generation-actions";

const aiConnected = isAIConnected();

// Real local-Postgres integration test (no mocking of Prisma) — scoped
// under throwaway Organizations created here and deleted in afterAll
// (cascades to Membership/Company/Workspace/DealStage/LeadOpportunity/
// AIAgentInstance/Proposal/Deal created during the test).
describe("generateProposalFromOpportunityCore", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let companyId: string;
  let otherOrgCompanyId: string;
  let workspaceId: string;
  let dealStageId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Proposal Generation Test Org", slug: `proposal-gen-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Proposal Generation Other Org", slug: `proposal-gen-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Proposal Gen Test User", email: `proposal-gen-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    workspaceId = workspace.id;
    const stage = await prisma.dealStage.create({ data: { workspaceId, name: "New", order: 0 } });
    dealStageId = stage.id;

    const company = await prisma.company.create({ data: { organizationId: orgId, name: "Proposal Gen Test Co", status: "PROSPECT" } });
    companyId = company.id;

    const otherOrgCompany = await prisma.company.create({ data: { organizationId: otherOrgId, name: "Other Org Co", status: "PROSPECT" } });
    otherOrgCompanyId = otherOrgCompany.id;

    // A real PROPOSAL agent for orgId only — otherOrgId deliberately has none.
    await prisma.aIAgentInstance.create({
      data: { organizationId: orgId, type: "PROPOSAL", name: "Priya", introMessage: "Ready to draft proposals." },
    });
  });

  afterAll(async () => {
    await prisma.proposal.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.deal.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.leadOpportunity.deleteMany({ where: { companyId: { in: [companyId, otherOrgCompanyId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const remainingProposals = await prisma.proposal.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(remainingProposals).toBe(0);
    const remainingDeals = await prisma.deal.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(remainingDeals).toBe(0);
  });

  async function createOpportunity(overrides: Partial<{ title: string; companyId: string; estimatedValue: number | null; status: "NEW" | "REVIEWED" | "ADDED_TO_CRM" | "DISMISSED" }> = {}) {
    return prisma.leadOpportunity.create({
      data: {
        companyId: overrides.companyId ?? companyId,
        category: "Website",
        title: overrides.title ?? "Outdated checkout flow",
        description: "The company's checkout abandons on mobile and has no saved-cart recovery.",
        estimatedImpact: "High",
        evidence: "Cart-abandonment tracking shows 62% mobile drop-off at payment step.",
        confidenceScore: 80,
        recommendedService: "WEBSITE_DEVELOPMENT",
        serviceMatchScore: 90,
        serviceMatchReason: "Checkout is broken on mobile, which is most of their traffic.",
        salesAngle: "Lead with the mobile conversion loss.",
        nextStep: "Send a teardown video of their checkout flow.",
        estimatedValue: overrides.estimatedValue === undefined ? 20000 : overrides.estimatedValue,
        status: overrides.status ?? "NEW",
      },
    });
  }

  it("rejects an opportunity belonging to a different organization", async () => {
    const otherOrgOpportunity = await createOpportunity({ companyId: otherOrgCompanyId, title: "Cross-org opportunity" });

    const result = await generateProposalFromOpportunityCore(orgId, userId, otherOrgOpportunity.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");
  });

  it("blocks generating a proposal from a DISMISSED opportunity", async () => {
    const opportunity = await createOpportunity({ title: "Dismissed opportunity", status: "DISMISSED" });

    const result = await generateProposalFromOpportunityCore(orgId, userId, opportunity.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("This opportunity was dismissed and cannot be turned into a proposal.");

    const proposalCount = await prisma.proposal.count({ where: { companyId } });
    expect(proposalCount).toBe(0);
  });

  it("returns an error when the organization has no PROPOSAL agent configured", async () => {
    const opportunity = await createOpportunity({ companyId: otherOrgCompanyId, title: "No agent org opportunity" });

    const result = await generateProposalFromOpportunityCore(otherOrgId, userId, opportunity.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Your Proposal agent isn't set up yet.");
  });

  it.skipIf(!aiConnected)(
    "happy path: creates a DRAFT Proposal grounded in the real opportunity, with no Deal linked when none exists yet",
    async () => {
      const opportunity = await createOpportunity({ title: "Happy path opportunity", estimatedValue: 20000 });

      const result = await generateProposalFromOpportunityCore(orgId, userId, opportunity.id);

      expect(result.ok).toBe(true);
      expect(result.proposalId).toBeTruthy();
      expect(result.dealId ?? null).toBeNull();

      const proposal = await prisma.proposal.findUnique({ where: { id: result.proposalId! } });
      expect(proposal).not.toBeNull();
      expect(proposal?.organizationId).toBe(orgId);
      expect(proposal?.companyId).toBe(companyId);
      expect(proposal?.dealId).toBeNull();
      expect(proposal?.status).toBe("DRAFT");
      expect(proposal?.title).toContain(opportunity.title);
      expect(proposal?.content.length ?? 0).toBeGreaterThan(0);

      const sections = proposal?.sections as Record<string, unknown> | null;
      expect(sections).not.toBeNull();
      expect(typeof sections?.executiveSummary).toBe("string");
      expect(typeof sections?.recommendedSolution).toBe("string");
    },
    60_000,
  );

  it.skipIf(!aiConnected)(
    "links to the existing Deal when the opportunity was already ADDED_TO_CRM",
    async () => {
      const opportunity = await createOpportunity({ title: "Already-in-CRM opportunity", status: "ADDED_TO_CRM" });
      const deal = await prisma.deal.create({
        data: {
          organizationId: orgId,
          dealStageId,
          companyId,
          name: `${opportunity.title} deal`,
          value: opportunity.estimatedValue,
        },
      });

      const result = await generateProposalFromOpportunityCore(orgId, userId, opportunity.id);

      expect(result.ok).toBe(true);
      expect(result.dealId).toBe(deal.id);

      const proposal = await prisma.proposal.findUnique({ where: { id: result.proposalId! } });
      expect(proposal?.dealId).toBe(deal.id);
    },
    60_000,
  );

  it.skipIf(!aiConnected)(
    "never fabricates a budget: Proposal.value is exactly LeadOpportunity.estimatedValue when set, and null when not sized — never a number invented by the AI",
    async () => {
      const sizedOpportunity = await createOpportunity({ title: "Sized opportunity", estimatedValue: 27500 });
      const sizedResult = await generateProposalFromOpportunityCore(orgId, userId, sizedOpportunity.id);
      expect(sizedResult.ok).toBe(true);
      const sizedProposal = await prisma.proposal.findUnique({ where: { id: sizedResult.proposalId! } });
      expect(sizedProposal?.value).toBe(27500);

      const unsizedOpportunity = await createOpportunity({ title: "Unsized opportunity", estimatedValue: null });
      const unsizedResult = await generateProposalFromOpportunityCore(orgId, userId, unsizedOpportunity.id);
      expect(unsizedResult.ok).toBe(true);
      const unsizedProposal = await prisma.proposal.findUnique({ where: { id: unsizedResult.proposalId! } });
      expect(unsizedProposal?.value).toBeNull();

      // The AI's commercialStructure narrative (if present) must never have
      // been parsed into Proposal.value — value stays null regardless of
      // whatever pricing language the AI wrote in that free-text field.
      const sections = unsizedProposal?.sections as Record<string, unknown> | null;
      if (sections && typeof sections.commercialStructure === "string") {
        expect(unsizedProposal?.value).toBeNull();
      }
    },
    90_000,
  );
});
