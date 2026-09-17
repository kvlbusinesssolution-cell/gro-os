import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { computeIntentScore } from "./intent-scoring";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/CompanyIntelligence/CompanyEvidence/IntentScore created during
// the test).
describe("computeIntentScore", () => {
  let organizationId: string;

  let signalCompanyId: string;
  let zeroSignalCompanyId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Intent Score Test Org", slug: `intent-score-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    // Company with real, populated signal lists + a real poor-performance
    // CompanyEvidence fact — every one of these traces back to a fixture
    // value asserted below, nothing fabricated by the function under test.
    const signalCompany = await prisma.company.create({
      data: {
        organizationId,
        name: "Signal Rich Co",
        industry: "Retail",
        website: "https://signal-rich.example.com",
      },
    });
    signalCompanyId = signalCompany.id;

    await prisma.companyIntelligence.create({
      data: {
        companyId: signalCompanyId,
        businessSummary: "A growing regional retailer.",
        growthSignals: ["Opened a second warehouse this quarter", "Revenue grew 30% year-over-year"],
        hiringSignals: ["Hiring a Head of E-commerce", "3 open engineering roles posted"],
        expansionIndicators: ["Announced expansion into two new states"],
        businessOpportunities: [],
        estimatedSoftwareNeeds: [],
        potentialPainPoints: [],
        confidenceScore: 0.75,
      },
    });

    await prisma.companyEvidence.create({
      data: {
        companyId: signalCompanyId,
        kind: "RAW_FACT",
        fact: "Performance score: 32/100",
        source: "WEBSITE_SCAN",
        confidence: 1.0,
      },
    });
    // A healthy score should NOT count as a problem signal.
    await prisma.companyEvidence.create({
      data: {
        companyId: signalCompanyId,
        kind: "RAW_FACT",
        fact: "SEO score: 88/100",
        source: "WEBSITE_SCAN",
        confidence: 1.0,
      },
    });

    // Company with no CompanyIntelligence and no CompanyEvidence at all —
    // the honest zero-signal case.
    const zeroSignalCompany = await prisma.company.create({
      data: {
        organizationId,
        name: "No Signal Co",
        industry: "Retail",
        website: "https://no-signal.example.com",
      },
    });
    zeroSignalCompanyId = zeroSignalCompany.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.company.count({ where: { organizationId } });
    expect(leaked).toBe(0);
  });

  it("computes a score/band/signals breakdown where every signal traces to a real fixture value", async () => {
    const result = await computeIntentScore(signalCompanyId);
    expect(result).not.toBeNull();
    if (!result) return;

    // 2 growth signals * 8 = 16, 2 hiring signals * 10 = 20, 1 expansion * 12 = 12,
    // 1 real problem fact (Performance 32/100 < 50) * 6 = 6. Subtotal = 54.
    // Data is fresh (just created) so +10 recency bonus => 64.
    expect(result.score).toBe(64);
    expect(result.band).toBe("MEDIUM");

    const detailTexts = result.signals.map((s) => s.detail);
    expect(detailTexts).toContain("Opened a second warehouse this quarter");
    expect(detailTexts).toContain("Revenue grew 30% year-over-year");
    expect(detailTexts).toContain("Hiring a Head of E-commerce");
    expect(detailTexts).toContain("3 open engineering roles posted");
    expect(detailTexts).toContain("Announced expansion into two new states");
    expect(detailTexts).toContain("Performance score: 32/100");
    // The healthy SEO fact must never be counted as a problem signal.
    expect(detailTexts).not.toContain("SEO score: 88/100");

    const totalPoints = result.signals.reduce((sum, s) => sum + s.points, 0);
    expect(totalPoints).toBe(64);

    expect(result.reasoning).toContain("Opened a second warehouse this quarter");
    expect(result.reasoning).toContain("64");
    expect(result.reasoning).toContain("MEDIUM");
  });

  it("persists an upserted IntentScore row and is idempotent on re-run (no duplicate rows)", async () => {
    await computeIntentScore(signalCompanyId);
    const firstCount = await prisma.intentScore.count({ where: { companyId: signalCompanyId } });
    expect(firstCount).toBe(1);

    const rerun = await computeIntentScore(signalCompanyId);
    const secondCount = await prisma.intentScore.count({ where: { companyId: signalCompanyId } });
    expect(secondCount).toBe(1); // unique constraint on companyId enforces upsert-not-append

    const row = await prisma.intentScore.findUnique({ where: { companyId: signalCompanyId } });
    expect(row).not.toBeNull();
    expect(row?.score).toBe(rerun?.score);
    expect(row?.band).toBe(rerun?.band);
  });

  it("returns score 0, band NONE, and an honest empty-case reasoning when there are no signals at all", async () => {
    const result = await computeIntentScore(zeroSignalCompanyId);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.score).toBe(0);
    expect(result.band).toBe("NONE");
    expect(result.signals).toEqual([]);
    expect(result.reasoning).toContain("No buying-intent signals found");
    expect(result.reasoning).not.toMatch(/lorem|placeholder/i);

    const row = await prisma.intentScore.findUnique({ where: { companyId: zeroSignalCompanyId } });
    expect(row?.score).toBe(0);
    expect(row?.band).toBe("NONE");
  });

  it("returns null for a nonexistent companyId", async () => {
    const result = await computeIntentScore("nonexistent-company-id-does-not-exist");
    expect(result).toBeNull();
  });
});
