import { describe, expect, it } from "vitest";

import { computeApplicationEligibility, type ApplicationEligibilityInput } from "./application-eligibility";
import type { JobMatchResult } from "./job-matching";

function matchDim(status: JobMatchResult["dimensions"]["skill"]["status"]) {
  return { status, evidence: [] };
}

function baseMatch(overrides: Partial<JobMatchResult["dimensions"]> = {}): JobMatchResult {
  return {
    overallScore: 80,
    eligibility: "LIKELY_ELIGIBLE",
    explanation: { whyMatched: [], whatIsMissing: [], whatIsRisky: [], whatShouldBeCustomized: [] },
    dimensions: {
      skill: matchDim("MATCHED"),
      experience: matchDim("MATCHED"),
      role: matchDim("MATCHED"),
      industry: matchDim("UNKNOWN"),
      location: matchDim("MATCHED"),
      salary: matchDim("UNKNOWN"),
      technology: matchDim("MATCHED"),
      careerLevel: matchDim("UNKNOWN"),
      preference: matchDim("UNKNOWN"),
      ...overrides,
    },
  };
}

function baseInput(overrides: Partial<ApplicationEligibilityInput> = {}): ApplicationEligibilityInput {
  return {
    matchResult: baseMatch(),
    jobRequirements: { required: ["React"], preferred: ["GraphQL"] },
    verifiedSkills: ["React", "TypeScript"],
    hasResume: true,
    hasVerifiedWorkAuthorization: true,
    ...overrides,
  };
}

describe("computeApplicationEligibility — §6/§7 real application-level eligibility", () => {
  it("returns ELIGIBLE when every real check is satisfied and the job-match itself is LIKELY_ELIGIBLE", () => {
    const result = computeApplicationEligibility(baseInput());
    expect(result.status).toBe("ELIGIBLE");
  });

  it("returns NOT_ELIGIBLE when a stated REQUIRED item is missing from verified skills (spec's own §6 worked example, inverted)", () => {
    const result = computeApplicationEligibility(baseInput({ jobRequirements: { required: ["Kubernetes"], preferred: [] } }));
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.checks.some((c) => c.requirement === "Required: Kubernetes" && c.status === "UNSATISFIED")).toBe(true);
  });

  it("never fails eligibility on a missing PREFERRED item alone (§7)", () => {
    const result = computeApplicationEligibility(baseInput({ jobRequirements: { required: [], preferred: ["Kubernetes"] } }));
    expect(result.status).not.toBe("NOT_ELIGIBLE");
    expect(result.status).not.toBe("LIKELY_NOT_ELIGIBLE");
  });

  it("returns NOT_ELIGIBLE when no resume is on file — a hard, real blocker", () => {
    const result = computeApplicationEligibility(baseInput({ hasResume: false }));
    expect(result.status).toBe("NOT_ELIGIBLE");
  });

  it("never assumes work authorization — REVIEW_REQUIRED when it's genuinely unverified (§13 worked example)", () => {
    const result = computeApplicationEligibility(baseInput({ hasVerifiedWorkAuthorization: null }));
    expect(result.checks.find((c) => c.requirement === "Work authorization")?.status).toBe("UNKNOWN");
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("returns NOT_ELIGIBLE when work authorization is explicitly, verifiably false", () => {
    const result = computeApplicationEligibility(baseInput({ hasVerifiedWorkAuthorization: false }));
    expect(result.status).toBe("NOT_ELIGIBLE");
  });

  it("returns UNKNOWN-driven REVIEW_REQUIRED when the source provided no structured required-items list at all", () => {
    const result = computeApplicationEligibility(baseInput({ jobRequirements: null }));
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("propagates a hard job-match MISMATCH (e.g. location) into LIKELY_NOT_ELIGIBLE rather than silently ignoring it", () => {
    const result = computeApplicationEligibility(baseInput({ matchResult: baseMatch({ location: matchDim("MISMATCH") }) }));
    expect(["LIKELY_NOT_ELIGIBLE", "NOT_ELIGIBLE"]).toContain(result.status);
  });
});
