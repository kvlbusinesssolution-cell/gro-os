import { describe, expect, it } from "vitest";

import { isValidTransition, assertValidTransition } from "./application-state-machine";

describe("application state machine — §49 real, deterministic transitions", () => {
  it("allows the real, documented happy path", () => {
    expect(isValidTransition("DISCOVERED", "MATCHED")).toBe(true);
    expect(isValidTransition("MATCHED", "SHORTLISTED")).toBe(true);
    expect(isValidTransition("SHORTLISTED", "PREPARING")).toBe(true);
    expect(isValidTransition("PREPARING", "READY_FOR_REVIEW")).toBe(true);
    expect(isValidTransition("READY_FOR_REVIEW", "USER_APPROVAL_REQUIRED")).toBe(true);
    expect(isValidTransition("USER_APPROVAL_REQUIRED", "SUBMITTING")).toBe(true);
    expect(isValidTransition("SUBMITTING", "SUBMITTED")).toBe(true);
    expect(isValidTransition("SUBMITTED", "CONFIRMED")).toBe(true);
    expect(isValidTransition("CONFIRMED", "INTERVIEW")).toBe(true);
    expect(isValidTransition("INTERVIEW", "OFFER")).toBe(true);
  });

  it("rejects an arbitrary, non-adjacent client-supplied jump (§3: no arbitrary client status changes)", () => {
    expect(isValidTransition("DISCOVERED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("DISCOVERED", "OFFER")).toBe(false);
  });

  it("rejects a same-status no-op transition", () => {
    expect(isValidTransition("SUBMITTED", "SUBMITTED")).toBe(false);
  });

  it("rejects moving backward out of a terminal state", () => {
    expect(isValidTransition("CLOSED", "DISCOVERED")).toBe(false);
    expect(isValidTransition("WITHDRAWN", "SUBMITTING")).toBe(false);
  });

  it("allows the real §56 partial-submission path: SUBMITTING -> SUBMITTED_UNCONFIRMED -> CONFIRMED", () => {
    expect(isValidTransition("SUBMITTING", "SUBMITTED_UNCONFIRMED")).toBe(true);
    expect(isValidTransition("SUBMITTED_UNCONFIRMED", "CONFIRMED")).toBe(true);
  });

  it("allows the real §56 uncertain-outcome-stays-uncertain path: SUBMITTED_UNCONFIRMED -> FAILED_REQUIRES_REVIEW, never a silent auto-retry loop back to SUBMITTING directly", () => {
    expect(isValidTransition("SUBMITTED_UNCONFIRMED", "FAILED_REQUIRES_REVIEW")).toBe(true);
    // Retrying from FAILED_REQUIRES_REVIEW is a real, distinct, explicit transition — not implied by the uncertain state itself.
    expect(isValidTransition("SUBMITTED_UNCONFIRMED", "SUBMITTING")).toBe(false);
    expect(isValidTransition("FAILED_REQUIRES_REVIEW", "SUBMITTING")).toBe(true);
  });

  it("allows the real §47 platform-restriction path without silently dropping the application", () => {
    expect(isValidTransition("READY_FOR_REVIEW", "PLATFORM_RESTRICTED")).toBe(true);
    expect(isValidTransition("PLATFORM_RESTRICTED", "USER_APPROVAL_REQUIRED")).toBe(true);
  });

  it("throws a real, descriptive error for an invalid transition", () => {
    expect(() => assertValidTransition("DISCOVERED", "CONFIRMED")).toThrow(/Invalid application status transition/);
  });

  it("allows withdrawal from every real, non-terminal in-flight state", () => {
    expect(isValidTransition("SHORTLISTED", "WITHDRAWN")).toBe(true);
    expect(isValidTransition("PREPARING", "WITHDRAWN")).toBe(true);
    expect(isValidTransition("READY_FOR_REVIEW", "WITHDRAWN")).toBe(true);
    expect(isValidTransition("USER_APPROVAL_REQUIRED", "WITHDRAWN")).toBe(true);
  });
});
