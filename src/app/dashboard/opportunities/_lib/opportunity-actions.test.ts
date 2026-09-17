import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// opportunity-actions.ts imports `auth` from "@/auth" at module scope for
// its session-gated wrappers (addOpportunityToCrm/dismissOpportunity/
// markOpportunityForReview). This test only exercises the headless *Core
// functions (which never call auth()), but next-auth's ESM build fails to
// resolve `next/server` under Vitest in this Next.js 16 environment
// (confirmed as a pre-existing, file-independent breakage: any test that
// imports "@/auth", even transitively, fails identically) — real
// application code is unaffected since Next.js's own build resolves it
// fine. Mocking the module here avoids loading next-auth at all, which is
// exactly why no comparable "use server" action file in this app has a
// colocated test today.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// revalidatePath() needs a Next.js request-scoped static-generation store
// that only exists inside a real request/action invocation; outside of one
// (as here, calling the *Core functions directly from Vitest) it throws.
// Stubbed for the same reason `auth` is mocked above.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";

import {
  addOpportunityToCrmCore,
  dismissOpportunityCore,
  markOpportunityForReviewCore,
} from "./opportunity-actions";

// Real local-Postgres integration test (no mocking of Prisma, matching the
// rest of this repo's Prisma-touching code, e.g. dedup.test.ts) — everything
// is scoped under two throwaway Organizations created here and deleted in
// afterAll (cascades to every Membership/Company/Workspace/DealStage/
// LeadOpportunity/Deal created during the test).
describe("opportunity-actions", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let companyId: string;
  let dealStageId: string;
  let otherOrgCompanyId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Opportunity Actions Test Org", slug: `opp-actions-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Opportunity Actions Other Org", slug: `opp-actions-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Opp Test User", email: `opp-actions-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const stage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "New", order: 0 } });
    dealStageId = stage.id;

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Acme Test Co", status: "PROSPECT" },
    });
    companyId = company.id;

    const otherOrgCompany = await prisma.company.create({
      data: { organizationId: otherOrgId, name: "Other Org Co", status: "PROSPECT" },
    });
    otherOrgCompanyId = otherOrgCompany.id;
  });

  afterAll(async () => {
    // Deals aren't cascade-linked to Company/Organization in a way that
    // guarantees ordering here, so delete them explicitly before the orgs.
    await prisma.deal.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.leadOpportunity.deleteMany({ where: { companyId: { in: [companyId, otherOrgCompanyId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const remainingDeals = await prisma.deal.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(remainingDeals).toBe(0);
  });

  async function createOpportunity(overrides: { title?: string } = {}) {
    return prisma.leadOpportunity.create({
      data: {
        companyId,
        category: "Website",
        title: overrides.title ?? "Outdated website",
        description: "The company's public site has not been updated in years.",
        estimatedImpact: "High",
        evidence: "Homepage last-modified header dated 2018.",
        confidenceScore: 80,
        recommendedService: "WEBSITE_DEVELOPMENT",
        serviceMatchScore: 90,
        serviceMatchReason: "Site is stale and unresponsive on mobile.",
        salesAngle: "Lead with the mobile conversion loss.",
        nextStep: "Send a teardown video of their homepage.",
        estimatedValue: 15000,
      },
    });
  }

  it("addOpportunityToCrmCore: happy path creates a Deal and marks the opportunity ADDED_TO_CRM", async () => {
    const opportunity = await createOpportunity();

    const result = await addOpportunityToCrmCore(orgId, userId, opportunity.id);

    expect(result.ok).toBe(true);
    expect(result.dealId).toBeTruthy();

    const deal = await prisma.deal.findUnique({ where: { id: result.dealId! } });
    expect(deal).not.toBeNull();
    expect(deal?.organizationId).toBe(orgId);
    expect(deal?.companyId).toBe(companyId);
    expect(deal?.dealStageId).toBe(dealStageId);
    expect(deal?.value).toBe(15000);
    expect(deal?.services).toEqual(["WEBSITE_DEVELOPMENT"]);
    expect(deal?.notes ?? "").toContain("Evidence:");
    expect(deal?.notes ?? "").toContain("Sales angle:");

    const updated = await prisma.leadOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(updated?.status).toBe("ADDED_TO_CRM");
  });

  it("addOpportunityToCrmCore: rejects an opportunity belonging to a different organization", async () => {
    const otherOrgOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: otherOrgCompanyId,
        category: "Website",
        title: "Cross-org opportunity",
        description: "Should never be visible to orgId.",
        estimatedImpact: "High",
        evidence: "n/a",
        confidenceScore: 50,
      },
    });

    const result = await addOpportunityToCrmCore(orgId, userId, otherOrgOpportunity.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");

    const untouched = await prisma.leadOpportunity.findUnique({ where: { id: otherOrgOpportunity.id } });
    expect(untouched?.status).toBe("NEW");
  });

  it("addOpportunityToCrmCore: blocks re-adding an opportunity already ADDED_TO_CRM", async () => {
    const opportunity = await createOpportunity({ title: "Already converted" });
    const first = await addOpportunityToCrmCore(orgId, userId, opportunity.id);
    expect(first.ok).toBe(true);

    const dealCountBefore = await prisma.deal.count({ where: { organizationId: orgId } });

    const second = await addOpportunityToCrmCore(orgId, userId, opportunity.id);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("This opportunity has already been added to the CRM.");

    const dealCountAfter = await prisma.deal.count({ where: { organizationId: orgId } });
    expect(dealCountAfter).toBe(dealCountBefore);
  });

  it("dismissOpportunityCore: happy path marks the opportunity DISMISSED", async () => {
    const opportunity = await createOpportunity({ title: "To dismiss" });

    const result = await dismissOpportunityCore(orgId, userId, opportunity.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.leadOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(updated?.status).toBe("DISMISSED");
  });

  it("dismissOpportunityCore: rejects an opportunity belonging to a different organization", async () => {
    const otherOrgOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: otherOrgCompanyId,
        category: "Website",
        title: "Cross-org dismiss target",
        description: "Should never be dismissable by orgId.",
        estimatedImpact: "Low",
        evidence: "n/a",
        confidenceScore: 30,
      },
    });

    const result = await dismissOpportunityCore(orgId, userId, otherOrgOpportunity.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");

    const untouched = await prisma.leadOpportunity.findUnique({ where: { id: otherOrgOpportunity.id } });
    expect(untouched?.status).toBe("NEW");
  });

  it("dismissOpportunityCore: blocks dismissing an opportunity already ADDED_TO_CRM", async () => {
    const opportunity = await createOpportunity({ title: "Convert then try to dismiss" });
    const added = await addOpportunityToCrmCore(orgId, userId, opportunity.id);
    expect(added.ok).toBe(true);

    const result = await dismissOpportunityCore(orgId, userId, opportunity.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("This opportunity has already been added to the CRM and can no longer be dismissed.");

    const updated = await prisma.leadOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(updated?.status).toBe("ADDED_TO_CRM");
  });

  it("markOpportunityForReviewCore: happy path marks the opportunity REVIEWED", async () => {
    const opportunity = await createOpportunity({ title: "To review" });

    const result = await markOpportunityForReviewCore(orgId, userId, opportunity.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.leadOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(updated?.status).toBe("REVIEWED");
  });

  it("markOpportunityForReviewCore: rejects an opportunity belonging to a different organization", async () => {
    const otherOrgOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: otherOrgCompanyId,
        category: "Website",
        title: "Cross-org review target",
        description: "Should never be reviewable by orgId.",
        estimatedImpact: "Low",
        evidence: "n/a",
        confidenceScore: 30,
      },
    });

    const result = await markOpportunityForReviewCore(orgId, userId, otherOrgOpportunity.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");

    const untouched = await prisma.leadOpportunity.findUnique({ where: { id: otherOrgOpportunity.id } });
    expect(untouched?.status).toBe("NEW");
  });

  it("markOpportunityForReviewCore: blocks reviewing an opportunity already ADDED_TO_CRM", async () => {
    const opportunity = await createOpportunity({ title: "Convert then try to review" });
    const added = await addOpportunityToCrmCore(orgId, userId, opportunity.id);
    expect(added.ok).toBe(true);

    const result = await markOpportunityForReviewCore(orgId, userId, opportunity.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("This opportunity has already been added to the CRM.");

    const updated = await prisma.leadOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(updated?.status).toBe("ADDED_TO_CRM");
  });

  it("addOpportunityToCrmCore: returns an error when the organization has no DealStage configured", async () => {
    const suffix = Date.now();
    const stagelessOrg = await prisma.organization.create({
      data: { name: "Stageless Org", slug: `opp-actions-stageless-${suffix}` },
    });
    const stagelessUser = await prisma.user.create({
      data: { name: "Stageless User", email: `opp-actions-stageless-${suffix}@example.com` },
    });
    await prisma.membership.create({
      data: { userId: stagelessUser.id, organizationId: stagelessOrg.id, role: "OWNER", status: "ACTIVE" },
    });
    // No Workspace/DealStage created for this org on purpose.
    const stagelessCompany = await prisma.company.create({
      data: { organizationId: stagelessOrg.id, name: "Stageless Co", status: "PROSPECT" },
    });
    const stagelessOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: stagelessCompany.id,
        category: "Website",
        title: "No pipeline yet",
        description: "n/a",
        estimatedImpact: "Low",
        evidence: "n/a",
        confidenceScore: 10,
      },
    });

    try {
      const result = await addOpportunityToCrmCore(stagelessOrg.id, stagelessUser.id, stagelessOpportunity.id);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("No deal pipeline stage configured for this organization.");
    } finally {
      await prisma.leadOpportunity.deleteMany({ where: { companyId: stagelessCompany.id } });
      await prisma.organization.delete({ where: { id: stagelessOrg.id } });
    }
  });
});
