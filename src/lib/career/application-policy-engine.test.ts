import { describe, expect, it } from "vitest";

import { evaluateAutonomySafetyGate, type PolicyGateInput } from "./application-policy-engine";

function baseInput(overrides: Partial<PolicyGateInput> = {}): PolicyGateInput {
  return {
    automationMode: "FULL_AUTONOMOUS",
    duplicateStatus: "NO_DUPLICATE",
    eligibilityStatus: "LIKELY_ELIGIBLE",
    minEligibilityForAutoApply: "LIKELY_ELIGIBLE",
    suspicionStatus: "NOT_SUSPICIOUS",
    companyExcluded: false,
    hasSelectedResume: true,
    hasRequiredDocuments: true,
    validationResult: "READY",
    submissionChannelAvailable: true,
    dailyApplicationsUsed: 0,
    maxApplicationsPerDay: 5,
    weeklyApplicationsUsed: 0,
    maxApplicationsPerWeek: 20,
    ...overrides,
  };
}

describe("evaluateAutonomySafetyGate — §48 the real 11-condition gate", () => {
  it("allows submission when every real condition passes under FULL_AUTONOMOUS", () => {
    const result = evaluateAutonomySafetyGate(baseInput());
    expect(result.decision).toBe("SUBMIT_ALLOWED");
    expect(result.conditions.every((c) => c.passed)).toBe(true);
  });

  it("never submits under DISCOVERY_ONLY regardless of how clean every other condition is (§19)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ automationMode: "DISCOVERY_ONLY" }));
    expect(result.decision).toBe("USER_APPROVAL_REQUIRED");
  });

  it("never submits under AI_PREPARE (§20 — prepare only, move to READY_FOR_REVIEW)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ automationMode: "AI_PREPARE" }));
    expect(result.decision).toBe("USER_APPROVAL_REQUIRED");
  });

  it("always requires approval under APPLY_WITH_APPROVAL even with a perfect application (§21)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ automationMode: "APPLY_WITH_APPROVAL" }));
    expect(result.decision).toBe("USER_APPROVAL_REQUIRED");
  });

  it("blocks on a confirmed duplicate even under FULL_AUTONOMOUS (§5/§22)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ duplicateStatus: "DUPLICATE_CONFIRMED" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
    expect(result.conditions.find((c) => c.name.includes("duplicate"))?.passed).toBe(false);
  });

  it("blocks when eligibility is below the user's configured minimum bar (§24)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ eligibilityStatus: "REVIEW_REQUIRED", minEligibilityForAutoApply: "LIKELY_ELIGIBLE" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("blocks on NOT_ELIGIBLE regardless of the user's configured minimum (§6/§48)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ eligibilityStatus: "NOT_ELIGIBLE", minEligibilityForAutoApply: "UNKNOWN" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("routes to PLATFORM_RESTRICTED when no real submission channel exists — never silently fails or fakes a submission (§15/§47)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ submissionChannelAvailable: false }));
    expect(result.decision).toBe("PLATFORM_RESTRICTED");
  });

  it("routes to APPLICATION_LIMIT_REACHED once the real daily limit is hit, even with everything else clean (§25)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ dailyApplicationsUsed: 5, maxApplicationsPerDay: 5 }));
    expect(result.decision).toBe("APPLICATION_LIMIT_REACHED");
  });

  it("routes to APPLICATION_LIMIT_REACHED once the real weekly limit is hit", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ weeklyApplicationsUsed: 20, maxApplicationsPerWeek: 20 }));
    expect(result.decision).toBe("APPLICATION_LIMIT_REACHED");
  });

  it("blocks on an excluded company even with a perfect match (§26/§48)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ companyExcluded: true }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("blocks on a suspicious job — never auto-submits (§26)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ suspicionStatus: "SUSPICIOUS" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("blocks on REVIEW_REQUIRED suspicion too — soft signals still gate autonomous submission", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ suspicionStatus: "REVIEW_REQUIRED" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("blocks when no resume is selected", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ hasSelectedResume: false }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("blocks when validation has not passed (READY)", () => {
    const result = evaluateAutonomySafetyGate(baseInput({ validationResult: "REVIEW_REQUIRED" }));
    expect(result.decision).not.toBe("SUBMIT_ALLOWED");
  });

  it("records all 11 conditions every time, never a collapsed single yes/no (§48)", () => {
    const result = evaluateAutonomySafetyGate(baseInput());
    expect(result.conditions.length).toBe(11);
  });
});
