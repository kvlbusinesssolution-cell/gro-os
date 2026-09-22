import { describe, expect, it } from "vitest";

import { isSensitiveQuestion, prepareApplicationAnswer, type AnswerProfileInput } from "./application-answers";

function baseProfile(overrides: Partial<AnswerProfileInput> = {}): AnswerProfileInput {
  return {
    yearsOfExperience: 5,
    currentRole: "Senior Frontend Engineer",
    location: "Bengaluru, India",
    relocationPreference: "WILLING",
    noticePeriodDays: 30,
    salaryMin: 20,
    salaryMax: 30,
    salaryCurrency: "USD",
    education: [{ degree: "B.Tech", institution: "IIT Delhi" }],
    certifications: [{ name: "AWS Certified Developer" }],
    skills: ["React", "TypeScript"],
    ...overrides,
  };
}

describe("isSensitiveQuestion — §13 real classification", () => {
  it("flags work authorization / visa / sponsorship questions as sensitive", () => {
    expect(isSensitiveQuestion("Do you require visa sponsorship?")).toBe(true);
    expect(isSensitiveQuestion("Are you authorized to work in the US?")).toBe(true);
  });
  it("flags demographic/legal declaration questions as sensitive", () => {
    expect(isSensitiveQuestion("Do you have a disability?")).toBe(true);
    expect(isSensitiveQuestion("Are you a veteran?")).toBe(true);
    expect(isSensitiveQuestion("Have you ever been convicted of a felony?")).toBe(true);
  });
  it("does not flag an ordinary factual question", () => {
    expect(isSensitiveQuestion("How many years of React experience do you have?")).toBe(false);
  });
});

describe("prepareApplicationAnswer — §12/§13/§38 real, provenance-tagged answers", () => {
  it("NEVER auto-answers a sensitive question, regardless of profile data — always USER_INPUT_REQUIRED", () => {
    const result = prepareApplicationAnswer("Do you require visa sponsorship?", baseProfile());
    expect(result.status).toBe("USER_INPUT_REQUIRED");
    expect(result.answer).toBeNull();
    expect(result.isSensitive).toBe(true);
  });

  it("answers years-of-experience deterministically from real profile data, with real provenance (spec's own §38 worked example)", () => {
    const result = prepareApplicationAnswer("How many years of React experience do you have?", baseProfile());
    expect(result.answer).toBe("5 years");
    expect(result.source).toBe("CAREER_PROFILE");
    expect(result.status).toBe("VERIFIED");
  });

  it("returns REVIEW_REQUIRED, never a guess, when the profile has no real data for a non-sensitive question", () => {
    const result = prepareApplicationAnswer("How many years of React experience do you have?", baseProfile({ yearsOfExperience: null }));
    expect(result.answer).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("answers notice period from real profile data", () => {
    const result = prepareApplicationAnswer("What is your notice period?", baseProfile());
    expect(result.answer).toBe("30 days");
    expect(result.status).toBe("VERIFIED");
  });

  it("answers relocation willingness from the real USER_PREFERENCE field", () => {
    const result = prepareApplicationAnswer("Are you willing to relocate?", baseProfile());
    expect(result.answer).toBe("WILLING");
    expect(result.source).toBe("USER_PREFERENCE");
  });

  it("answers salary expectation from real profile data", () => {
    const result = prepareApplicationAnswer("What is your salary expectation?", baseProfile());
    expect(result.answer).toContain("20");
    expect(result.answer).toContain("30");
  });

  it("returns REVIEW_REQUIRED for a question with no real, confident mapping to a verified field — never a free-text guess", () => {
    const result = prepareApplicationAnswer("Describe a time you resolved a difficult conflict at work.", baseProfile());
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.answer).toBeNull();
  });
});
