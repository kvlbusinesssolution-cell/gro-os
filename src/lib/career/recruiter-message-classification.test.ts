import { describe, expect, it } from "vitest";

import { detectsSensitiveQuestion } from "./recruiter-message-classification";

describe("detectsSensitiveQuestion — §13/§46 real, deterministic keyword gate", () => {
  it("flags a work-authorization question", () => {
    expect(detectsSensitiveQuestion("Can you confirm your work authorization status for this role?")).toBe(true);
  });

  it("flags a visa/sponsorship question", () => {
    expect(detectsSensitiveQuestion("Will you require visa sponsorship?")).toBe(true);
  });

  it("flags a disability/veteran declaration request", () => {
    expect(detectsSensitiveQuestion("Please complete the voluntary disability self-identification form.")).toBe(true);
  });

  it("does NOT flag an ordinary scheduling email", () => {
    expect(detectsSensitiveQuestion("Are you available for a call on Tuesday at 3pm?")).toBe(false);
  });

  it("does NOT flag an ordinary salary-range question", () => {
    expect(detectsSensitiveQuestion("What is your expected salary range for this role?")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(detectsSensitiveQuestion("WORK AUTHORIZATION required before we proceed.")).toBe(true);
  });
});
