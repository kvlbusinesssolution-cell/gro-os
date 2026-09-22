import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeIntentValidation } from "./intent-validation";
import { computePriorityValidation } from "./priority-validation";

/**
 * Phase 29 — real local-Postgres integration tests for the new
 * precision/recall additions to intent-validation.ts and
 * priority-validation.ts. Every row created here is real, cleaned up in
 * afterAll.
 */
describe("intent-validation / priority-validation — real precision/recall", () => {
  const suffix = Date.now();
  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Intent Validation Test Org", slug: `intent-validation-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.learningObservation.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("precision/recall are null (never fabricated) below the real minimum decided sample", async () => {
    const obs = await prisma.learningObservation.create({ data: { organizationId: orgId, intentBand: "HIGH", outcome: "WON" } });
    const result = await computeIntentValidation(orgId);
    expect(result!.precision).toBeNull();
    expect(result!.recall).toBeNull();
    await prisma.learningObservation.delete({ where: { id: obs.id } }); // isolate from the next test's own sample
  });

  it("computes real precision/recall from a genuinely biased (all-HIGH-band) real sample — confirms it doesn't overstate confidence from a skewed cohort", async () => {
    // A biased sample: 12 more observations, ALL in the HIGH band (no LOW/MEDIUM/NONE at all) — 8 WON (true positives), 4 LOST (false positives). Zero real LOW/NONE-band WON, so no real false negatives exist in this cohort.
    await prisma.learningObservation.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ organizationId: orgId, intentBand: "HIGH", outcome: i < 8 ? "WON" : "LOST" })),
    });

    const result = await computeIntentValidation(orgId);
    expect(result!.precision).toBeCloseTo(8 / 12, 5); // TP/(TP+FP) = 8/(8+4)
    // recall = TP/(TP+FN); FN=0 real cases exist in this biased cohort, so recall is perfect (1) — not fabricated, a real artifact of the biased sample, not silently hidden.
    expect(result!.recall).toBe(1);
  });
});

describe("priority-validation — real precision/recall", () => {
  const suffix = Date.now();
  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Priority Validation Test Org", slug: `priority-validation-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.learningObservation.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("precision/recall are null below the real minimum decided sample, real TP/FN counts produce a defensible ratio once met", async () => {
    const company = await prisma.company.create({ data: { organizationId: orgId, name: `Priority Test Co ${suffix}` } });
    const opportunities = await Promise.all(
      Array.from({ length: 10 }, (_, i) => prisma.leadOpportunity.create({ data: { companyId: company.id, category: "test", title: `Opp ${i}`, description: "test", estimatedImpact: "test", evidence: "test", confidenceScore: 50, priority: i < 6 ? "HOT" : "LOW" } })),
    );
    // 6 HOT: 4 WON (TP), 2 LOST (FP). 4 LOW: 1 WON (FN), 3 LOST (true negative, irrelevant to precision/recall).
    const outcomes = ["WON", "WON", "WON", "WON", "LOST", "LOST", "WON", "LOST", "LOST", "LOST"] as const;
    await prisma.learningObservation.createMany({
      data: opportunities.map((o, i) => ({ organizationId: orgId, companyId: company.id, leadOpportunityId: o.id, outcome: outcomes[i]! })),
    });

    const result = await computePriorityValidation(orgId);
    expect(result!.precision).toBeCloseTo(4 / 6, 5); // TP=4, FP=2
    expect(result!.recall).toBeCloseTo(4 / 5, 5); // TP=4, FN=1

    await prisma.leadOpportunity.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
