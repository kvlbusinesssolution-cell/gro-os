import { describe, expect, it } from "vitest";

import { runValidationEngine, type ValidationEngineInput } from "./application-validation";

function baseInput(overrides: Partial<ValidationEngineInput> = {}): ValidationEngineInput {
  return {
    duplicateStatus: "NO_DUPLICATE",
    eligibilityStatus: "ELIGIBLE",
    suspicionStatus: "NOT_SUSPICIOUS",
    selectedResumeId: "resume-1",
    hasCustomizedResume: true,
    customizedResumeBlocked: false,
    hasCoverLetter: true,
    unresolvedSensitiveAnswers: 0,
    reviewRequiredAnswers: 0,
    ...overrides,
  };
}

describe("runValidationEngine — §14 the real aggregate gate", () => {
  it("returns READY when every real check is clean", () => {
    expect(runValidationEngine(baseInput()).result).toBe("READY");
  });

  it("returns BLOCKED on a confirmed duplicate — never READY (§5)", () => {
    const result = runValidationEngine(baseInput({ duplicateStatus: "DUPLICATE_CONFIRMED" }));
    expect(result.result).toBe("BLOCKED");
  });

  it("returns BLOCKED when the fabrication check blocked the customized resume (§10)", () => {
    const result = runValidationEngine(baseInput({ customizedResumeBlocked: true }));
    expect(result.result).toBe("BLOCKED");
  });

  it("returns BLOCKED on a confirmed-suspicious job", () => {
    expect(runValidationEngine(baseInput({ suspicionStatus: "SUSPICIOUS" })).result).toBe("BLOCKED");
  });

  it("returns BLOCKED when no resume is selected", () => {
    expect(runValidationEngine(baseInput({ selectedResumeId: null })).result).toBe("BLOCKED");
  });

  it("returns BLOCKED while a sensitive question is unresolved (§13) — never proceeds with a guessed answer", () => {
    expect(runValidationEngine(baseInput({ unresolvedSensitiveAnswers: 1 })).result).toBe("BLOCKED");
  });

  it("returns REVIEW_REQUIRED (not READY, not BLOCKED) for a possible duplicate", () => {
    expect(runValidationEngine(baseInput({ duplicateStatus: "POSSIBLE_DUPLICATE" })).result).toBe("REVIEW_REQUIRED");
  });

  it("returns REVIEW_REQUIRED when eligibility itself is still under review", () => {
    expect(runValidationEngine(baseInput({ eligibilityStatus: "REVIEW_REQUIRED" })).result).toBe("REVIEW_REQUIRED");
  });

  it("returns REVIEW_REQUIRED when no cover letter was generated (e.g. AI unavailable)", () => {
    expect(runValidationEngine(baseInput({ hasCoverLetter: false })).result).toBe("REVIEW_REQUIRED");
  });

  it("records every individual check, never a bare pass/fail with no detail", () => {
    const result = runValidationEngine(baseInput());
    expect(result.checks.length).toBeGreaterThan(3);
    expect(result.checks.every((c) => typeof c.detail === "string" && c.detail.length > 0)).toBe(true);
  });
});
