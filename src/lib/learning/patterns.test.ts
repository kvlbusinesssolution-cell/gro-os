import { describe, expect, it } from "vitest";

import type { LearningObservation } from "@/generated/prisma/client";
import { computeCohortStats, computeConfidenceFactors, sampleClassification, confidenceBucket, companySizeBand } from "./patterns";
import { LEARNING_CONFIG } from "./config";

/**
 * Pure-function unit tests — synthetic in-memory fixtures only (§56: never
 * production data). No Prisma/DB touched; these functions take a plain
 * LearningObservation[] and return a value.
 */

let seq = 0;
function obs(partial: Partial<LearningObservation>): LearningObservation {
  seq += 1;
  return {
    id: `obs-${seq}`,
    organizationId: "org-1",
    companyId: null,
    contactId: null,
    decisionMakerId: null,
    leadOpportunityId: "",
    dealId: null,
    proposalId: null,
    meetingId: null,
    replyId: null,
    campaignId: null,
    sequenceId: null,
    revenueAttributionId: null,
    channel: null,
    service: null,
    country: null,
    industry: null,
    companySize: null,
    technologies: [],
    intentScore: null,
    intentBand: null,
    intentSignals: [],
    decisionMakerRole: null,
    messageAngle: null,
    dealSize: null,
    salesCycleDays: null,
    objections: [],
    leadSource: null,
    outcome: "UNKNOWN",
    revenue: null,
    stageTimestamps: {},
    modelVersion: null,
    promptVersion: null,
    aiProvider: null,
    predictionTimestamp: new Date("2026-01-01"),
    actualOutcomeTimestamp: null,
    datasetVersion: "v1",
    analysisVersion: "v1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  } as LearningObservation;
}

describe("computeCohortStats", () => {
  it("computes conversionRate as an EXPLICIT denominator of decided (won+lost) outcomes only — never of the full cohort (§13)", () => {
    const observations = [
      obs({ outcome: "WON", dealSize: 100 }),
      obs({ outcome: "WON", dealSize: 200 }),
      obs({ outcome: "LOST" }),
      obs({ outcome: "CONTACTED" }), // still open — must NOT count in the denominator
      obs({ outcome: "REPLIED" }), // still open — must NOT count in the denominator
    ];
    const stats = computeCohortStats(observations);
    expect(stats.sampleSize).toBe(5);
    expect(stats.positiveOutcomes).toBe(2);
    expect(stats.negativeOutcomes).toBe(1);
    expect(stats.conversionRate).toBeCloseTo(2 / 3); // 2 won / (2 won + 1 lost), NOT /5
    expect(stats.avgDealSize).toBe(150);
  });

  it("returns conversionRate=null (never a fabricated 0%) when there are zero decided outcomes", () => {
    const stats = computeCohortStats([obs({ outcome: "CONTACTED" }), obs({ outcome: "MEETING" })]);
    expect(stats.conversionRate).toBeNull();
  });
});

describe("sampleClassification (§9 configurable thresholds)", () => {
  const zeroStats = (n: number) => computeCohortStats(Array.from({ length: n }, () => obs({ outcome: "WON" })));

  it("below MIN_SAMPLE_INSUFFICIENT is always INSUFFICIENT_DATA", () => {
    expect(sampleClassification(zeroStats(LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT - 1), 1)).toBe("INSUFFICIENT_DATA");
  });

  it("at/above MIN_SAMPLE_INSUFFICIENT but below MIN_SAMPLE_OBSERVED is LOW_SAMPLE", () => {
    expect(sampleClassification(zeroStats(LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT), 1)).toBe("LOW_SAMPLE");
  });

  it("at/above MIN_SAMPLE_OBSERVED but below MIN_SAMPLE_STRONG is OBSERVED", () => {
    expect(sampleClassification(zeroStats(LEARNING_CONFIG.MIN_SAMPLE_OBSERVED), 1)).toBe("OBSERVED");
  });

  it("at/above MIN_SAMPLE_STRONG WITHOUT real time-stability stays OBSERVED, never STRONG_OBSERVATION (§52 — volume alone is not enough)", () => {
    expect(sampleClassification(zeroStats(LEARNING_CONFIG.MIN_SAMPLE_STRONG), 0)).toBe("OBSERVED");
  });

  it("at/above MIN_SAMPLE_STRONG WITH real time-stability becomes STRONG_OBSERVATION", () => {
    expect(sampleClassification(zeroStats(LEARNING_CONFIG.MIN_SAMPLE_STRONG), 0.9)).toBe("STRONG_OBSERVATION");
  });
});

describe("confidenceBucket", () => {
  it("is hard-capped at LOW for INSUFFICIENT_DATA/LOW_SAMPLE regardless of how high the weighted score is (§9 — sample size is a gate, not just one weighted factor)", () => {
    expect(confidenceBucket(0.99, "INSUFFICIENT_DATA")).toBe("LOW");
    expect(confidenceBucket(0.99, "LOW_SAMPLE")).toBe("LOW");
  });

  it("uses the configured cutoffs once the sample floor is cleared", () => {
    expect(confidenceBucket(LEARNING_CONFIG.CONFIDENCE_HIGH_CUTOFF, "OBSERVED")).toBe("HIGH");
    expect(confidenceBucket(LEARNING_CONFIG.CONFIDENCE_MEDIUM_CUTOFF, "OBSERVED")).toBe("MEDIUM");
    expect(confidenceBucket(0, "OBSERVED")).toBe("LOW");
  });
});

describe("computeConfidenceFactors", () => {
  it("scores a consistent, complete, single-leadSource cohort with reasonably high outcomeConsistency/dataCompleteness", () => {
    const observations = Array.from({ length: 12 }, (_, i) =>
      obs({
        outcome: i < 10 ? "WON" : "LOST",
        industry: "SaaS",
        country: "India",
        companySize: 80,
        service: "WEBSITE_DEVELOPMENT",
        channel: "EMAIL",
        decisionMakerRole: "CTO",
        intentBand: "HIGH",
        leadSource: "LEAD_FINDER",
        predictionTimestamp: new Date(2026, 0, i + 1),
      }),
    );
    const factors = computeConfidenceFactors(observations, 0.5);
    expect(factors.dataCompleteness).toBe(1); // every key dimension populated on every row
    expect(factors.weightedScore).toBeGreaterThan(0.5);
  });

  it("scores an incomplete cohort (missing key dimensions) with dataCompleteness below 1", () => {
    const observations = Array.from({ length: 12 }, () => obs({ outcome: "WON" })); // no industry/country/etc.
    const factors = computeConfidenceFactors(observations, 0.5);
    expect(factors.dataCompleteness).toBe(0);
  });

  it("false positive/negative detection: a cohort where outcomes flip direction between the two halves gets low outcomeConsistency", () => {
    const observations = [
      ...Array.from({ length: 6 }, (_, i) => obs({ outcome: "WON", predictionTimestamp: new Date(2026, 0, i + 1) })),
      ...Array.from({ length: 6 }, (_, i) => obs({ outcome: "LOST", predictionTimestamp: new Date(2026, 1, i + 1) })),
    ];
    const factors = computeConfidenceFactors(observations, 0.5);
    expect(factors.outcomeConsistency).toBeLessThan(0.5);
  });
});

describe("companySizeBand", () => {
  it("buckets deterministically and returns null for unknown size — never guesses a band", () => {
    expect(companySizeBand(5)).toBe("1-10");
    expect(companySizeBand(150)).toBe("51-200");
    expect(companySizeBand(5000)).toBe("1000+");
    expect(companySizeBand(null)).toBeNull();
  });
});
