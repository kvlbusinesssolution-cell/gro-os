import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { buildProposalContext } from "./proposal-context";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code, e.g. opportunity-brief.test.ts) —
// scoped under two throwaway Organizations created here and deleted in
// afterAll.
describe("buildProposalContext", () => {
  let organizationId: string;
  let userId: string;
  let companyId: string;
  let opportunityId: string;
  let contactId: string;

  let bareCompanyId: string;
  let bareOpportunityId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Proposal Context Test Org", slug: `proposal-context-test-org-${suffix}` },
    });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { name: "Proposal Context Test User", email: `proposal-context-user-${suffix}@example.com` },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        organizationId,
        name: "Proposal Context Retail Co",
        industry: "Retail",
        website: "https://proposal-context-retail.example.com",
        headquartersCity: "Austin",
        headquartersCountry: "United States",
        employeeCount: 40,
      },
    });
    companyId = company.id;

    await prisma.companyIntelligence.create({
      data: {
        companyId,
        businessSummary: "A regional home-goods retailer with a single physical storefront.",
        growthSignals: [],
        hiringSignals: [],
        expansionIndicators: [],
        businessOpportunities: [],
        estimatedSoftwareNeeds: [],
        potentialPainPoints: ["Losing sales to competitors with online stores"],
        recommendedSolution: "Launch a full e-commerce storefront with product catalog and checkout.",
        estimatedProjectValue: 18000,
        confidenceScore: 0.8,
      },
    });

    await prisma.decisionMaker.create({
      data: {
        companyId,
        name: "Jordan Reyes",
        role: "FOUNDER",
        source: "LinkedIn",
        confidence: 0.9,
      },
    });

    const contact = await prisma.contact.create({
      data: { organizationId, companyId, firstName: "Jordan", lastName: "Reyes", email: `jordan-${suffix}@example.com` },
    });
    contactId = contact.id;

    await prisma.reply.create({
      data: {
        organizationId,
        contactId,
        channel: "EMAIL",
        content: "We'd love to see a proposal — our budget is flexible for the right solution.",
        sentiment: "POSITIVE",
        intent: "REQUEST_PROPOSAL",
        loggedByUserId: userId,
        receivedAt: new Date("2026-01-05T10:00:00Z"),
      },
    });

    await prisma.outreachMeeting.create({
      data: {
        organizationId,
        contactId,
        title: "Discovery call",
        agenda: "Walk through current checkout gaps.",
        discussionTopics: ["Cart abandonment", "Mobile checkout"],
        notes: "Client confirmed they want a Shopify-style checkout by Q3.",
      },
    });

    const opportunity = await prisma.leadOpportunity.create({
      data: {
        companyId,
        category: "E-commerce",
        title: "No online checkout despite selling physical products",
        description: "The company sells physical home-goods products but has no e-commerce checkout on its website.",
        estimatedImpact: "high",
        estimatedValue: 15000,
        evidence: "Website audit found no cart/checkout flow on the live site.",
        confidenceScore: 82,
        recommendedService: "ECOMMERCE_DEVELOPMENT",
        serviceMatchScore: 91,
        serviceMatchReason: "The site sells physical products with no transactional capability at all.",
        salesAngle: "Lead with the lost-sales angle, not a generic redesign pitch.",
        nextStep: "Offer a free 15-minute e-commerce readiness audit.",
      },
    });
    opportunityId = opportunity.id;

    // A bare company/opportunity with none of the above real data, to prove
    // the honest-fallback discipline rather than fabrication.
    const bareCompany = await prisma.company.create({ data: { organizationId, name: "Bare Context Co" } });
    bareCompanyId = bareCompany.id;
    const bareOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: bareCompanyId,
        category: "Legacy",
        title: "Opportunity with nothing else researched",
        description: "Detected from a manual note only.",
        estimatedImpact: "low",
        evidence: "Manual note evidence.",
        confidenceScore: 40,
      },
    });
    bareOpportunityId = bareOpportunity.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leakedOpportunities = await prisma.leadOpportunity.count({ where: { companyId: { in: [companyId, bareCompanyId] } } });
    expect(leakedOpportunities).toBe(0);
    const leakedCompanies = await prisma.company.count({ where: { id: { in: [companyId, bareCompanyId] } } });
    expect(leakedCompanies).toBe(0);
    const leakedUser = await prisma.user.findUnique({ where: { id: userId } });
    if (leakedUser) await prisma.user.delete({ where: { id: userId } });
  });

  it("composes every real fact from LeadOpportunity + CompanyIntelligence + Reply history + OutreachMeeting notes + DecisionMakers", async () => {
    const context = await buildProposalContext(opportunityId);
    expect(context).not.toBeNull();
    if (!context) return;

    // Company
    expect(context).toContain("Proposal Context Retail Co");
    expect(context).toContain("Retail");
    expect(context).toContain("Austin");

    // Opportunity
    expect(context).toContain("The company sells physical home-goods products but has no e-commerce checkout");
    expect(context).toContain("Website audit found no cart/checkout flow");
    expect(context).toContain("Lead with the lost-sales angle");
    expect(context).toContain("Offer a free 15-minute e-commerce readiness audit");
    expect(context).toContain("Estimated deal value (real, already sized on this opportunity): 15000");

    // CompanyIntelligence
    expect(context).toContain("Losing sales to competitors with online stores");
    expect(context).toContain("Launch a full e-commerce storefront");

    // Decision makers
    expect(context).toContain("Jordan Reyes (FOUNDER)");

    // Real communication history — labeled, chronological, content verbatim
    expect(context).toContain("Real communication history (actual replies received, chronological)");
    expect(context).toContain("We'd love to see a proposal — our budget is flexible for the right solution.");
    expect(context).toContain("intent: REQUEST_PROPOSAL");

    // Real meeting notes
    expect(context).toContain("Real meeting notes");
    expect(context).toContain("Client confirmed they want a Shopify-style checkout by Q3.");
    expect(context).toContain("Cart abandonment, Mobile checkout");
  });

  it("returns null for a nonexistent opportunityId", async () => {
    const context = await buildProposalContext("nonexistent-opportunity-id-does-not-exist");
    expect(context).toBeNull();
  });

  it("gives honest 'not available' fallbacks (never fabricated facts) for a company with no intelligence, replies, meetings, or decision makers", async () => {
    const context = await buildProposalContext(bareOpportunityId);
    expect(context).not.toBeNull();
    if (!context) return;

    expect(context).toContain("Bare Context Co");
    expect(context).toContain("Company Intelligence: no AI Company Intelligence report generated yet for this company.");
    expect(context).toContain("Known decision makers: none verified yet for this company.");
    expect(context).toContain("Estimated deal value: not yet sized — do not state or invent a number.");
    expect(context).toContain("no contacts on file for this company yet.");
    // Never invents a number for the un-sized opportunity.
    expect(context).not.toMatch(/Estimated deal value \(real/);
  });
});
