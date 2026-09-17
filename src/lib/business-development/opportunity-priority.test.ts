import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { computeOpportunityScore } from "./opportunity-priority";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/LeadScore/IntentScore/CompanyEvidence/LeadOpportunity created
// during the test).
//
// Hand-calculated expectations use the documented weights from
// opportunity-priority.ts:
//   WEIGHTS = { problemSeverity: 0.25, serviceMatch: 0.25, evidenceQuality: 0.15, intent: 0.20, businessRelevance: 0.15 }
describe("computeOpportunityScore", () => {
  let organizationId: string;

  let strongCompanyId: string;
  let strongOpportunityId: string;

  let weakCompanyId: string;
  let weakOpportunityId: string;

  let dismissedCompanyId: string;
  let dismissedOpportunityId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Opportunity Priority Test Org", slug: `opportunity-priority-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    // ---- Fixture A: "strong" — everything high, every sub-score explicitly controlled. ----
    const strongCompany = await prisma.company.create({
      data: { organizationId, name: "Strong Signal Co", industry: "Retail", website: "https://strong-signal.example.com" },
    });
    strongCompanyId = strongCompany.id;

    // businessRelevance = 70 (reused, not recomputed).
    await prisma.leadScore.create({
      data: {
        companyId: strongCompanyId,
        industryMatchScore: 70,
        companySizeScore: 70,
        growthScore: 70,
        technologyFitScore: 70,
        opportunitySizeScore: 70,
        budgetPotentialScore: 70,
        locationScore: 70,
        digitalMaturityScore: 70,
        automationNeedScore: 70,
        overallScore: 70,
        band: "WARM",
      },
    });

    // intent = 80 (reused, not recomputed) — set directly so the fixture's
    // math is fully controlled rather than depending on computeIntentScore.
    await prisma.intentScore.create({
      data: { companyId: strongCompanyId, score: 80, band: "HIGH", signals: [], reasoning: "Fixture-set intent score." },
    });

    // evidenceQuality bucket needs count >= 6 -> 95.
    await prisma.companyEvidence.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        companyId: strongCompanyId,
        kind: "RAW_FACT" as const,
        fact: `Fixture evidence fact ${i + 1}`,
        source: "WEBSITE_SCAN" as const,
        confidence: 1.0,
      })),
    });

    const strongOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: strongCompanyId,
        category: "E-commerce",
        title: "Strong opportunity fixture",
        description: "Fixture opportunity with every sub-score controlled for exact-match assertions.",
        estimatedImpact: "high", // problemSeverity = 100
        evidence: "Fixture evidence text.",
        confidenceScore: 90,
        serviceMatchScore: 90, // serviceMatch = 90
      },
    });
    strongOpportunityId = strongOpportunity.id;

    // ---- Fixture B: "weak" — no LeadScore, no serviceMatchScore, no evidence, no signals. ----
    const weakCompany = await prisma.company.create({
      data: { organizationId, name: "Weak Signal Co", industry: "Retail", website: "https://weak-signal.example.com" },
    });
    weakCompanyId = weakCompany.id;

    const weakOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: weakCompanyId,
        category: "General",
        title: "Weak opportunity fixture",
        description: "Fixture opportunity with no supporting LeadScore/IntentScore/evidence/serviceMatch yet.",
        estimatedImpact: "low", // problemSeverity = 30
        evidence: "Fixture evidence text.",
        confidenceScore: 40,
        // serviceMatchScore intentionally omitted -> defaults to 50
      },
    });
    weakOpportunityId = weakOpportunity.id;

    // ---- Fixture C: DISMISSED override — high score inputs, but status forces DISQUALIFIED. ----
    const dismissedCompany = await prisma.company.create({
      data: { organizationId, name: "Dismissed Signal Co", industry: "Retail", website: "https://dismissed-signal.example.com" },
    });
    dismissedCompanyId = dismissedCompany.id;

    await prisma.leadScore.create({
      data: {
        companyId: dismissedCompanyId,
        industryMatchScore: 90,
        companySizeScore: 90,
        growthScore: 90,
        technologyFitScore: 90,
        opportunitySizeScore: 90,
        budgetPotentialScore: 90,
        locationScore: 90,
        digitalMaturityScore: 90,
        automationNeedScore: 90,
        overallScore: 90,
        band: "HOT",
      },
    });

    const dismissedOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: dismissedCompanyId,
        category: "E-commerce",
        title: "Dismissed opportunity fixture",
        description: "High-scoring fixture whose status should force DISQUALIFIED regardless of math.",
        estimatedImpact: "high",
        evidence: "Fixture evidence text.",
        confidenceScore: 95,
        serviceMatchScore: 95,
        status: "DISMISSED",
      },
    });
    dismissedOpportunityId = dismissedOpportunity.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.company.count({ where: { organizationId } });
    expect(leaked).toBe(0);
  });

  it("(A) computes the exact weighted total for a fully-controlled 'strong' fixture", async () => {
    // problemSeverity=100 (high), serviceMatch=90, evidenceQuality=95 (6 evidence rows),
    // intent=80 (fixture-set IntentScore), businessRelevance=70 (fixture-set LeadScore).
    // total = 0.25*100 + 0.25*90 + 0.15*95 + 0.20*80 + 0.15*70
    //       = 25 + 22.5 + 14.25 + 16 + 10.5 = 88.25 -> round -> 88
    const result = await computeOpportunityScore(strongOpportunityId);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.breakdown).toEqual({
      problemSeverity: 100,
      serviceMatch: 90,
      evidenceQuality: 95,
      intent: 80,
      businessRelevance: 70,
      total: 88,
    });
    expect(result.opportunityScore).toBe(88);
    expect(result.priority).toBe("HOT"); // total(88) >= HOT threshold(80)
    expect(result.priorityReasoning).toContain("HOT");
    expect(result.priorityReasoning).toContain("88");

    const row = await prisma.leadOpportunity.findUnique({ where: { id: strongOpportunityId } });
    expect(row?.opportunityScore).toBe(88);
    expect(row?.priority).toBe("HOT");
    expect(row?.opportunityScoreBreakdown).toEqual(result.breakdown);
  });

  it("(B) computes the exact weighted total for a 'weak' fixture with every default/fallback engaged", async () => {
    // problemSeverity=30 (low), serviceMatch=50 (no serviceMatchScore -> default),
    // evidenceQuality=20 (0 evidence rows), intent=0 (no signals at all -> computeIntentScore -> 0),
    // businessRelevance=50 (no LeadScore -> default).
    // total = 0.25*30 + 0.25*50 + 0.15*20 + 0.20*0 + 0.15*50
    //       = 7.5 + 12.5 + 3 + 0 + 7.5 = 30.5 -> round -> 31
    const result = await computeOpportunityScore(weakOpportunityId);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.breakdown).toEqual({
      problemSeverity: 30,
      serviceMatch: 50,
      evidenceQuality: 20,
      intent: 0,
      businessRelevance: 50,
      total: 31,
    });
    expect(result.opportunityScore).toBe(31);
    expect(result.priority).toBe("NURTURE"); // 25 <= 31 < 45

    // computeOpportunityScore should have computed-and-persisted an IntentScore
    // for this company as a side effect, since none existed yet.
    const intentRow = await prisma.intentScore.findUnique({ where: { companyId: weakCompanyId } });
    expect(intentRow).not.toBeNull();
    expect(intentRow?.score).toBe(0);
    expect(intentRow?.band).toBe("NONE");
  });

  it("(C) DISMISSED status always forces DISQUALIFIED, regardless of how high the underlying score is", async () => {
    const result = await computeOpportunityScore(dismissedOpportunityId);
    expect(result).not.toBeNull();
    if (!result) return;

    // problemSeverity=100 (high), serviceMatch=95, evidenceQuality=20 (no evidence rows),
    // intent=0 (no signals -> computed fresh), businessRelevance=90 (fixture LeadScore).
    // total = 0.25*100 + 0.25*95 + 0.15*20 + 0.20*0 + 0.15*90
    //       = 25 + 23.75 + 3 + 0 + 13.5 = 65.25 -> round -> 65
    // 65 alone would map to HIGH (>= HIGH threshold 65) — but the DISMISSED
    // status override takes priority over that math entirely.
    expect(result.breakdown.total).toBe(65);
    expect(result.priority).toBe("DISQUALIFIED");
    expect(result.priorityReasoning).toContain("DISMISSED");

    const row = await prisma.leadOpportunity.findUnique({ where: { id: dismissedOpportunityId } });
    expect(row?.priority).toBe("DISQUALIFIED");
  });

  it("is idempotent — re-running produces the same score/breakdown/priority and updates the same row", async () => {
    const first = await computeOpportunityScore(strongOpportunityId);
    const second = await computeOpportunityScore(strongOpportunityId);
    expect(second).toEqual(first);

    const count = await prisma.leadOpportunity.count({ where: { id: strongOpportunityId } });
    expect(count).toBe(1);
  });

  it("returns null for a nonexistent opportunityId", async () => {
    const result = await computeOpportunityScore("nonexistent-opportunity-id-does-not-exist");
    expect(result).toBeNull();
  });
});
