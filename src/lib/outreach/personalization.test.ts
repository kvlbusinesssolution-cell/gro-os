import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";

import { buildContactContext } from "./personalization";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/Contact/CompanyEvidence/LeadOpportunity/LeadScore/IntentScore/
// DecisionMaker created during the test).
describe("buildContactContext", () => {
  let organizationId: string;

  let richCompanyId: string;
  let richContactId: string;

  let bareCompanyId: string;
  let bareContactId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Personalization Test Org", slug: `personalization-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    // --- Rich fixture: a company with every Phase 1-4 data type present. ---
    const richCompany = await prisma.company.create({
      data: {
        organizationId,
        name: "Personalization Test Retail Co",
        industry: "Retail",
        headquartersCity: "Austin",
        headquartersCountry: "United States",
        technologies: ["Shopify", "Klaviyo"],
      },
    });
    richCompanyId = richCompany.id;

    await prisma.companyEvidence.createMany({
      data: [
        {
          companyId: richCompanyId,
          kind: "RAW_FACT",
          fact: "Performance score: 42/100",
          source: "WEBSITE_SCAN",
          confidence: 1.0,
        },
        {
          companyId: richCompanyId,
          kind: "RAW_FACT",
          fact: "No online checkout found on the live site",
          source: "WEBSITE_SCAN",
          confidence: 1.0,
        },
      ],
    });

    await prisma.leadOpportunity.create({
      data: {
        companyId: richCompanyId,
        category: "E-commerce",
        title: "No online store despite selling physical products",
        description: "The company sells physical home-goods products but has no e-commerce checkout on its website.",
        estimatedImpact: "high",
        evidence: "Website audit found no cart/checkout flow on the live site.",
        confidenceScore: 82,
        recommendedService: "ECOMMERCE_DEVELOPMENT",
        serviceMatchScore: 91,
        salesAngle: "They're turning away online buyers today — lead with the lost-sales angle.",
        nextStep: "Offer a free 15-minute e-commerce readiness audit.",
        status: "NEW",
      },
    });

    await prisma.leadScore.create({
      data: {
        companyId: richCompanyId,
        industryMatchScore: 80,
        companySizeScore: 70,
        growthScore: 60,
        technologyFitScore: 75,
        opportunitySizeScore: 85,
        budgetPotentialScore: 65,
        locationScore: 90,
        digitalMaturityScore: 40,
        automationNeedScore: 55,
        overallScore: 78,
        band: "WARM",
      },
    });

    await prisma.intentScore.create({
      data: {
        companyId: richCompanyId,
        score: 62,
        band: "MEDIUM",
        signals: [{ signal: "hiring", source: "CompanyIntelligence", detail: "Recent hiring activity", points: 20 }],
        reasoning: "Recent hiring and expansion activity suggest medium buying intent.",
      },
    });

    await prisma.decisionMaker.create({
      data: {
        companyId: richCompanyId,
        name: "Jamie Rivera",
        role: "CTO",
        source: "Company website /about page",
        confidence: 0.9,
      },
    });

    const richContact = await prisma.contact.create({
      data: {
        organizationId,
        companyId: richCompanyId,
        // Deliberately different case from the DecisionMaker's stored name —
        // the match must be case-insensitive.
        firstName: "jamie",
        lastName: "RIVERA",
        email: "jamie.rivera@personalization-test-retail.example.com",
        jobTitle: "CTO",
      },
    });
    richContactId = richContact.id;

    // --- Bare fixture: a company with none of the Phase 1-4 data. ---
    const bareCompany = await prisma.company.create({
      data: { organizationId, name: "Bare Personalization Test Co" },
    });
    bareCompanyId = bareCompany.id;

    const bareContact = await prisma.contact.create({
      data: {
        organizationId,
        companyId: bareCompanyId,
        firstName: "Sam",
        lastName: "Nobody",
        email: "sam@bare-personalization-test.example.com",
      },
    });
    bareContactId = bareContact.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leakedCompanies = await prisma.company.count({ where: { id: { in: [richCompanyId, bareCompanyId] } } });
    expect(leakedCompanies).toBe(0);

    const leakedContacts = await prisma.contact.count({ where: { id: { in: [richContactId, bareContactId] } } });
    expect(leakedContacts).toBe(0);
  });

  it("includes every real Phase 1-4 section with the real fixture values", async () => {
    const context = await buildContactContext(richContactId);

    // Real verified CompanyEvidence facts.
    expect(context).toContain("Real verified facts:");
    expect(context).toContain("- Performance score: 42/100");
    expect(context).toContain("- No online checkout found on the live site");

    // Detected opportunity, with the KVL service label resolved.
    const service = KVL_SERVICES.find((s) => s.id === "ECOMMERCE_DEVELOPMENT");
    expect(context).toContain("Detected opportunity: No online store despite selling physical products");
    expect(context).toContain(
      "Description: The company sells physical home-goods products but has no e-commerce checkout on its website.",
    );
    expect(context).toContain("Evidence: Website audit found no cart/checkout flow on the live site.");
    expect(context).toContain(`Recommended service: ${service?.label}`);
    expect(context).toContain("Sales angle: They're turning away online buyers today");
    expect(context).toContain("Suggested next step: Offer a free 15-minute e-commerce readiness audit.");

    // LeadScore.
    expect(context).toContain("Lead relevance: 78/100 (WARM).");

    // IntentScore.
    expect(context).toContain("Buying intent signals: MEDIUM (Recent hiring and expansion activity suggest medium buying intent.)");

    // DecisionMaker name-match (case-insensitive).
    expect(context).toContain("This contact is the company's CTO, identified via Company website /about page.");
  });

  it("degrades to honest 'not available' language for a company with none of the Phase 1-4 data, without crashing", async () => {
    const context = await buildContactContext(bareContactId);

    expect(context).toContain("No real verified facts (CompanyEvidence) recorded yet for this company.");
    expect(context).toContain("No detected LeadOpportunity exists yet for this company.");
    expect(context).toContain("No Lead Score computed yet for this company.");
    expect(context).toContain("No buying-intent signals scored yet for this company.");
    expect(context).not.toContain("This contact is the company's");

    // Pre-existing (pre-Phase-5) sections still behave exactly as before.
    expect(context).toContain("Contact: Sam Nobody");
    expect(context).toContain("Company: Bare Personalization Test Co");
    expect(context).toContain("Technology stack: not researched yet.");
    expect(context).toContain("No AI Company Intelligence report exists yet for this company — no researched pain points available.");
    expect(context).toContain("No Website Scanner report exists yet for this company — no opportunity score available.");
  });

  it("still throws for a nonexistent contactId, unchanged from before", async () => {
    await expect(buildContactContext("nonexistent-contact-id-does-not-exist")).rejects.toThrow();
  });
});
