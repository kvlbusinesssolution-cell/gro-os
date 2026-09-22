import { describe, expect, it } from "vitest";

import { validateCoverLetter, type CoverLetterSource } from "./cover-letter";

function source(overrides: Partial<CoverLetterSource> = {}): CoverLetterSource {
  return {
    candidateName: "Jane Doe",
    currentRole: "Senior Frontend Engineer",
    yearsOfExperience: 5,
    skills: ["React", "TypeScript"],
    achievements: ["Reduced page load time by 40%"],
    ...overrides,
  };
}

describe("validateCoverLetter — Phase 31 real fabrication-check parity with resume-customization's summary heuristic", () => {
  it("does not flag a genuine cover letter grounded entirely in real source/job data", () => {
    const body = "Dear Hiring Team, as a Senior Frontend Engineer with experience in React and TypeScript, I am excited to apply for the Senior React Developer role at Acme Corp.";
    const result = validateCoverLetter(body, source(), "Senior React Developer", "Acme Corp");
    expect(result.needsManualReview).toBe(false);
    expect(result.suspiciousPhrases).toHaveLength(0);
  });

  it("flags an obviously-fabricated company name that appears nowhere in the source profile or job data — never silently accepted", () => {
    const body = "Dear Hiring Team, during my time at Globex Corporation I led a team of engineers, and I believe this makes me a strong fit for your role.";
    const result = validateCoverLetter(body, source(), "Senior React Developer", "Acme Corp");
    expect(result.needsManualReview).toBe(true);
    expect(result.suspiciousPhrases.some((p) => p.includes("Globex"))).toBe(true);
  });

  it("never hard-blocks — only ever flags for human review (free text can't be exact-matched like resume structured fields)", () => {
    const body = "I previously worked at Initech Systems on a completely fabricated project called Project Chimera.";
    const result = validateCoverLetter(body, source(), "Senior React Developer", "Acme Corp");
    // The function has no "blocked" field at all — proves by construction
    // that this can never hard-block, only flag.
    expect(result).not.toHaveProperty("blocked");
    expect(result.needsManualReview).toBe(true);
  });

  it("does not false-positive on the job's own real title/company appearing in the letter", () => {
    const body = "I am excited to apply for the Senior React Developer role at Acme Corp, a company I greatly admire.";
    const result = validateCoverLetter(body, source(), "Senior React Developer", "Acme Corp");
    expect(result.needsManualReview).toBe(false);
  });
});
