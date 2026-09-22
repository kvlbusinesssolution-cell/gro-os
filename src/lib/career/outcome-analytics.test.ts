import { describe, expect, it } from "vitest";

import { classifySampleSize, classifyConfidence, buildRateObservation } from "./outcome-analytics";
import { LEARNING_CONFIG } from "@/lib/learning/config";

describe("classifySampleSize / classifyConfidence — §16 real, reused Learning-engine thresholds", () => {
  it("classifies below MIN_SAMPLE_INSUFFICIENT as INSUFFICIENT_DATA", () => {
    expect(classifySampleSize(LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT - 1)).toBe("INSUFFICIENT_DATA");
  });

  it("classifies at MIN_SAMPLE_OBSERVED as OBSERVED", () => {
    expect(classifySampleSize(LEARNING_CONFIG.MIN_SAMPLE_OBSERVED)).toBe("OBSERVED");
  });

  it("classifies at MIN_SAMPLE_STRONG as STRONG_OBSERVATION", () => {
    expect(classifySampleSize(LEARNING_CONFIG.MIN_SAMPLE_STRONG)).toBe("STRONG_OBSERVATION");
  });

  it("never returns MEDIUM/HIGH confidence for an INSUFFICIENT_DATA/LOW_SAMPLE classification — a hard gate, not just a weighted factor (§15)", () => {
    expect(classifyConfidence(2, "INSUFFICIENT_DATA")).toBe("LOW");
    expect(classifyConfidence(15, "LOW_SAMPLE")).toBe("LOW");
  });
});

describe("buildRateObservation — §17/§62/§63 correlation-only wording, never causation", () => {
  it("§62 small sample test: Resume A (2 applications, 1 interview) is reported as INSUFFICIENT_DATA, never as a stronger signal than a real 50-application sample", () => {
    const resumeA = buildRateObservation("interviews", 1, 2, [new Date()]);
    const resumeB = buildRateObservation("interviews", 8, 50, [new Date()]);

    expect(resumeA.sampleClassification).toBe("INSUFFICIENT_DATA");
    expect(resumeA.confidence).toBe("LOW");
    expect(resumeA.statement).toContain("INSUFFICIENT_DATA");
    // Resume A's raw rate (50%) is numerically higher than Resume B's (16%),
    // but the system must never present A as "better" — the caller-facing
    // statement for the tiny sample explicitly flags its own unreliability
    // rather than asserting a clean percentage as if it meant something.
    expect(resumeA.statement).not.toMatch(/50%\)\.$/);

    expect(resumeB.sampleClassification).toBe("OBSERVED");
    expect(resumeB.statement).toContain("16%");
  });

  it("§63 correlation test: an association statement is grammatically an association, never a causal claim", () => {
    const obs = buildRateObservation('responses for applications mentioning "react"', 20, 70, [new Date()]);
    expect(obs.statement).toMatch(/was associated with/i);
    expect(obs.statement.toLowerCase()).not.toContain("caused");
    expect(obs.statement.toLowerCase()).not.toContain("causes");
  });

  it("returns a real null rate (never a fabricated 0%) for a zero-denominator cohort", () => {
    const obs = buildRateObservation("responses", 0, 0, []);
    expect(obs.rate).toBeNull();
    expect(obs.sampleClassification).toBe("INSUFFICIENT_DATA");
    expect(obs.statement).toContain("No observed sample");
  });

  it("computes real time-period bounds from the given dates, never fabricated", () => {
    const d1 = new Date("2026-01-01");
    const d2 = new Date("2026-03-01");
    const obs = buildRateObservation("responses", 1, 2, [d2, d1]);
    expect(obs.timePeriodStart).toEqual(d1);
    expect(obs.timePeriodEnd).toEqual(d2);
  });
});
