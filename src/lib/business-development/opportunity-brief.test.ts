import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";

import { buildOpportunityBrief } from "./opportunity-brief";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/CompanyIntelligence/LeadOpportunity created during the test).
describe("buildOpportunityBrief", () => {
  let organizationId: string;
  let companyId: string;
  let opportunityId: string;

  let bareCompanyId: string;
  let bareOpportunityId: string;

  let noIntelCompanyId: string;
  let noIntelOpportunityId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Opportunity Brief Test Org", slug: `opportunity-brief-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const company = await prisma.company.create({
      data: {
        organizationId,
        name: "Brief Test Retail Co",
        industry: "Retail",
        website: "https://brief-test-retail.example.com",
        headquartersCity: "Austin",
        headquartersCountry: "United States",
      },
    });
    companyId = company.id;

    await prisma.companyIntelligence.create({
      data: {
        companyId,
        businessSummary: "A regional home-goods retailer with a single physical storefront and no online store.",
        digitalPresenceSummary:
          "Website is a single static page with no online ordering, no customer accounts, and no email capture.",
        growthSignals: [],
        hiringSignals: [],
        expansionIndicators: [],
        businessOpportunities: ["No online store despite selling physical products"],
        estimatedSoftwareNeeds: ["E-commerce platform"],
        potentialPainPoints: ["Losing sales to competitors with online stores"],
        confidenceScore: 0.8,
      },
    });

    const opportunity = await prisma.leadOpportunity.create({
      data: {
        companyId,
        category: "E-commerce",
        title: "No online store despite selling physical products",
        description: "The company sells physical home-goods products but has no e-commerce checkout on its website.",
        estimatedImpact: "high",
        estimatedValue: 15000,
        evidence: "Website audit found no cart/checkout flow and no product catalog pages on the live site.",
        confidenceScore: 82,
        recommendedService: "ECOMMERCE_DEVELOPMENT",
        serviceMatchScore: 91,
        serviceMatchReason: "The site sells physical products with no transactional selling capability at all.",
        salesAngle:
          "They're turning away online buyers today — lead with the lost-sales angle, not a generic redesign pitch.",
        nextStep: "Offer a free 15-minute e-commerce readiness audit referencing their current static site.",
      },
    });
    opportunityId = opportunity.id;

    // (a) Simulates a pre-migration row: no recommendedService set.
    const bareCompany = await prisma.company.create({
      data: { organizationId, name: "Bare Service Co" },
    });
    bareCompanyId = bareCompany.id;

    const bareOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: bareCompanyId,
        category: "Legacy",
        title: "Legacy opportunity with no service match",
        description: "Predates KVL service matching.",
        estimatedImpact: "medium",
        estimatedValue: null,
        evidence: "Some pre-migration evidence text.",
        confidenceScore: 50,
      },
    });
    bareOpportunityId = bareOpportunity.id;

    // (c) A company with no CompanyIntelligence row at all.
    const noIntelCompany = await prisma.company.create({
      data: { organizationId, name: "No Intel Co", industry: "Logistics", employeeCount: 40 },
    });
    noIntelCompanyId = noIntelCompany.id;

    const noIntelOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: noIntelCompanyId,
        category: "Automation",
        title: "Opportunity with no linked intelligence row",
        description: "Detected from manual notes, not an intelligence run.",
        estimatedImpact: "low",
        estimatedValue: null,
        evidence: "Manual note evidence.",
        confidenceScore: 40,
      },
    });
    noIntelOpportunityId = noIntelOpportunity.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.leadOpportunity.count({
      where: { companyId: { in: [companyId, bareCompanyId, noIntelCompanyId] } },
    });
    expect(leaked).toBe(0);

    const leakedCompanies = await prisma.company.count({
      where: { id: { in: [companyId, bareCompanyId, noIntelCompanyId] } },
    });
    expect(leakedCompanies).toBe(0);
  });

  it("composes every field correctly from the real Company + CompanyIntelligence + LeadOpportunity rows", async () => {
    const brief = await buildOpportunityBrief(opportunityId);
    expect(brief).not.toBeNull();
    if (!brief) return;

    expect(brief.companyOverview).toContain("Brief Test Retail Co");
    expect(brief.companyOverview).toContain("Retail");
    expect(brief.companyOverview).toContain("Austin");
    expect(brief.companyOverview).toContain("United States");
    expect(brief.companyOverview).toContain("A regional home-goods retailer");

    expect(brief.detectedProblem).toBe(
      "The company sells physical home-goods products but has no e-commerce checkout on its website.",
    );

    expect(brief.businessContext).toBe(
      "Website is a single static page with no online ordering, no customer accounts, and no email capture.",
    );

    expect(brief.evidence).toBe(
      "Website audit found no cart/checkout flow and no product catalog pages on the live site.",
    );

    const catalogEntry = KVL_SERVICES.find((s) => s.id === "ECOMMERCE_DEVELOPMENT");
    expect(brief.recommendedService).toEqual({ id: "ECOMMERCE_DEVELOPMENT", label: catalogEntry?.label });

    expect(brief.whyThisService).toBe(
      "The site sells physical products with no transactional selling capability at all.",
    );
    expect(brief.confidence).toBe(82);
    expect(brief.serviceMatchScore).toBe(91);
    expect(brief.recommendedSalesAngle).toBe(
      "They're turning away online buyers today — lead with the lost-sales angle, not a generic redesign pitch.",
    );
    expect(brief.recommendedNextStep).toBe(
      "Offer a free 15-minute e-commerce readiness audit referencing their current static site.",
    );
  });

  it("(a) returns recommendedService: null for an opportunity with no recommendedService (pre-migration row), without crashing", async () => {
    const brief = await buildOpportunityBrief(bareOpportunityId);
    expect(brief).not.toBeNull();
    if (!brief) return;

    expect(brief.recommendedService).toBeNull();
    expect(brief.whyThisService).toBeNull();
    expect(brief.serviceMatchScore).toBeNull();
    expect(brief.recommendedSalesAngle).toBeNull();
    expect(brief.recommendedNextStep).toBeNull();
    expect(brief.detectedProblem).toBe("Predates KVL service matching.");
  });

  it("(b) returns null for a nonexistent opportunityId", async () => {
    const brief = await buildOpportunityBrief("nonexistent-opportunity-id-does-not-exist");
    expect(brief).toBeNull();
  });

  it("(c) gives an honest fallback businessContext (not fabricated) for a company with no CompanyIntelligence row", async () => {
    const brief = await buildOpportunityBrief(noIntelOpportunityId);
    expect(brief).not.toBeNull();
    if (!brief) return;

    expect(brief.businessContext).toContain("No additional business context researched yet.");
    expect(brief.businessContext).toContain("No Intel Co");
    expect(brief.businessContext).toContain("Logistics");
    expect(brief.businessContext).toContain("40");
  });
});
