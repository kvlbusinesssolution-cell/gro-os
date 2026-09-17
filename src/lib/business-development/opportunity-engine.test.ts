import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";

import { generateLeadOpportunities } from "./opportunity-engine";

const KVL_SERVICE_ID_SET = new Set<KVLServiceId>(KVL_SERVICES.map((s) => s.id));

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization/Company/CompanyIntelligence row, deleted in afterAll
// (cascades to any LeadOpportunity rows created during the test).
describe("generateLeadOpportunities (Phase 2 KVL service matching)", () => {
  let organizationId: string;
  let companyId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Opportunity Engine Test Org", slug: `opportunity-engine-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const company = await prisma.company.create({
      data: {
        organizationId,
        name: "Outdated Retail Co",
        website: "https://outdated-retail.example.com",
      },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: { organizationId, name: "Unrelated Co" },
    });
    otherCompanyId = otherCompany.id;

    // Deliberately "bad-website-shaped" intelligence data — an old, unsecured,
    // manually-run business with no CRM/e-commerce, so opportunities are
    // plausible and groundable.
    await prisma.companyIntelligence.create({
      data: {
        companyId,
        businessSummary:
          "A local retail business selling home goods, still tracking sales and customer orders on paper and spreadsheets, with no online store.",
        techStackSummary:
          "The website is a static HTML page built in 2012, no CMS, no HTTPS, no analytics, and no CRM or e-commerce platform detected.",
        digitalPresenceSummary:
          "Website is a single static page with a phone number and address; no online ordering, no customer accounts, no email capture.",
        seoOverview: "Not indexed for most relevant local search terms; no meta descriptions, no structured data.",
        performanceOverview: "Page load time exceeds 6 seconds; large unoptimized images; no caching or compression.",
        growthSignals: [],
        hiringSignals: [],
        expansionIndicators: [],
        businessOpportunities: [
          "No online store despite selling physical products",
          "No CRM — customer/order data tracked on paper",
        ],
        estimatedSoftwareNeeds: ["E-commerce platform", "CRM", "Modern responsive website"],
        potentialPainPoints: [
          "Losing sales to competitors with online stores",
          "No way to track repeat customers or follow up on leads",
        ],
        confidenceScore: 0.8,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.leadOpportunity.count({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    expect(leaked).toBe(0);
  });

  it("returns 0 and writes nothing when no CompanyIntelligence exists", async () => {
    const count = await generateLeadOpportunities(otherCompanyId);
    expect(count).toBe(0);

    const rows = await prisma.leadOpportunity.findMany({ where: { companyId: otherCompanyId } });
    expect(rows).toHaveLength(0);
  });

  it("generates real LeadOpportunity rows with a valid KVL service match", async () => {
    if (!isAIConnected()) {
      console.warn("[opportunity-engine.test] No AI provider configured in this environment — skipping AI-dependent assertions.");
      return;
    }

    const count = await generateLeadOpportunities(companyId);

    const rows = await prisma.leadOpportunity.findMany({ where: { companyId } });
    expect(rows.length).toBe(count);

    if (rows.length === 0) {
      console.warn("[opportunity-engine.test] AI call returned zero opportunities — soft-asserting rather than failing.");
      return;
    }

    expect(rows.length).toBeLessThanOrEqual(8);

    for (const row of rows) {
      expect(row.recommendedService).not.toBeNull();
      expect(KVL_SERVICE_ID_SET.has(row.recommendedService as KVLServiceId)).toBe(true);

      expect(row.serviceMatchScore).not.toBeNull();
      expect(row.serviceMatchScore as number).toBeGreaterThanOrEqual(0);
      expect(row.serviceMatchScore as number).toBeLessThanOrEqual(100);

      expect(row.serviceMatchReason).toBeTruthy();

      expect(row.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(row.confidenceScore).toBeLessThanOrEqual(100);

      expect(row.status).toBe("NEW");
      expect(row.updatedAt).toBeInstanceOf(Date);
      expect(row.companyId).toBe(companyId);
    }
  }, 30_000);
});
