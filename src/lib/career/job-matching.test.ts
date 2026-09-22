import { describe, expect, it } from "vitest";

import { computeJobMatch, type JobMatchInput } from "./job-matching";

function baseProfile(overrides: Partial<JobMatchInput> = {}): JobMatchInput {
  return {
    verifiedSkills: [],
    targetRoles: [],
    currentRole: null,
    yearsOfExperience: null,
    industries: [],
    targetCountries: [],
    targetCities: [],
    workMode: null,
    relocationPreference: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    preferredTechnologies: [],
    excludedTechnologies: [],
    preferredCompanies: [],
    excludedCompanies: [],
    careerLevel: null,
    job: {
      company: "Acme",
      title: "Software Engineer",
      location: null,
      country: null,
      city: null,
      workMode: null,
      technologies: [],
      industry: null,
      careerLevel: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      experienceMinYears: null,
      experienceMaxYears: null,
      requiredTechnologies: [],
      preferredTechnologiesFromJob: [],
    },
    ...overrides,
  };
}

describe("computeJobMatch — spec §49 worked example 1: strong match", () => {
  // Career Profile: Senior React Developer, React/TypeScript/Next.js,
  // 5 years, India, Remote, SaaS. Job: Senior Frontend Engineer, requires
  // React/TypeScript, 5+ years, Remote. Expected: strong role/skill/
  // experience/location match.
  const input = baseProfile({
    verifiedSkills: ["React", "TypeScript", "Next.js"],
    targetRoles: ["Senior React Developer"],
    yearsOfExperience: 5,
    industries: ["SaaS"],
    workMode: "REMOTE",
    job: {
      ...baseProfile().job,
      title: "Senior Frontend Engineer",
      technologies: ["React", "TypeScript"],
      requiredTechnologies: ["React", "TypeScript"],
      workMode: "REMOTE",
      experienceMinYears: 5,
    },
  });
  const result = computeJobMatch(input);

  it("skill: MATCHED — both required technologies are verified", () => {
    expect(result.dimensions.skill.status).toBe("MATCHED");
  });
  it("experience: MATCHED — 5 years verified meets the 5+ requirement", () => {
    expect(result.dimensions.experience.status).toBe("MATCHED");
  });
  it("location: MATCHED — remote job, remote preference", () => {
    expect(result.dimensions.location.status).toBe("MATCHED");
  });
  it("role: at least PARTIAL — 'Senior' + 'Frontend'/'Engineer' vs 'Senior React Developer' shares real tokens", () => {
    expect(["MATCHED", "PARTIAL"]).toContain(result.dimensions.role.status);
  });
  it("eligibility is LIKELY_ELIGIBLE given a MATCHED skill dimension and no missing/mismatch blockers", () => {
    expect(result.eligibility).toBe("LIKELY_ELIGIBLE");
  });
  it("overallScore is a real high number reflecting the strong match, not fabricated", () => {
    expect(result.overallScore).toBeGreaterThan(60);
  });
});

describe("computeJobMatch — spec §49 worked example 2: partial match with a real gap", () => {
  // Job requires React/TypeScript/AWS/7+ years. Profile has React/TypeScript,
  // 5 years. Expected: React/TS MATCHED, AWS MISSING, experience GAP,
  // eligibility REVIEW_REQUIRED or LIKELY_NOT_ELIGIBLE — never "eligible"
  // just because most skills match.
  const input = baseProfile({
    verifiedSkills: ["React", "TypeScript"],
    yearsOfExperience: 5,
    job: {
      ...baseProfile().job,
      technologies: ["React", "TypeScript", "AWS"],
      requiredTechnologies: ["React", "TypeScript", "AWS"],
      experienceMinYears: 7,
    },
  });
  const result = computeJobMatch(input);

  it("skill: PARTIAL — 2 of 3 required technologies verified, AWS missing", () => {
    expect(result.dimensions.skill.status).toBe("PARTIAL");
    expect(result.explanation.whatIsMissing.some((e) => e.includes("AWS"))).toBe(false); // MISSING list only includes MISSING-status dimensions, not PARTIAL ones
    expect(result.dimensions.skill.evidence.some((e) => e.includes("AWS"))).toBe(true); // but the dimension's own evidence does cite the real gap
  });
  it("experience: MISSING — 5 verified years is a real, disclosed gap below the 7-year requirement", () => {
    expect(result.dimensions.experience.status).toBe("MISSING");
  });
  it("never claims eligible when a real experience gap exists", () => {
    expect(result.eligibility).not.toBe("LIKELY_ELIGIBLE");
    expect(["LIKELY_NOT_ELIGIBLE", "REVIEW_REQUIRED", "POSSIBLE"]).toContain(result.eligibility);
  });
});

describe("computeJobMatch — UNKNOWN handling (§17/§33)", () => {
  it("never converts UNKNOWN into a silent pass — a dimension the source doesn't provide contributes zero weight, not a free 100", () => {
    const input = baseProfile(); // everything null/empty — every dimension should be UNKNOWN
    const result = computeJobMatch(input);
    expect(result.dimensions.skill.status).toBe("UNKNOWN");
    expect(result.dimensions.experience.status).toBe("UNKNOWN");
    expect(result.overallScore).toBe(0); // no real evidence anywhere — score must be 0, not a fabricated default
  });

  it("salary is UNKNOWN (never estimated) when the job doesn't disclose it, even with a real user salary preference", () => {
    const input = baseProfile({ salaryMin: 80000, salaryMax: 120000, salaryCurrency: "USD" });
    const result = computeJobMatch(input);
    expect(result.dimensions.salary.status).toBe("UNKNOWN");
  });

  it("salary is UNKNOWN (never converted) on a currency mismatch without a verified exchange rate", () => {
    const input = baseProfile({
      salaryMin: 80000,
      salaryMax: 120000,
      salaryCurrency: "USD",
      job: { ...baseProfile().job, salaryMin: 6000000, salaryMax: 9000000, salaryCurrency: "INR" },
    });
    const result = computeJobMatch(input);
    expect(result.dimensions.salary.status).toBe("UNKNOWN");
  });
});

describe("computeJobMatch — explicit exclusions are real hard negatives (§26, §30)", () => {
  it("an excluded company is MISMATCH on preference and pulls eligibility to LIKELY_NOT_ELIGIBLE, regardless of skill match", () => {
    const input = baseProfile({
      verifiedSkills: ["React"],
      yearsOfExperience: 10,
      excludedCompanies: ["Acme"],
      job: { ...baseProfile().job, company: "Acme", technologies: ["React"], requiredTechnologies: ["React"], experienceMinYears: 1 },
    });
    const result = computeJobMatch(input);
    expect(result.dimensions.preference.status).toBe("MISMATCH");
    expect(result.eligibility).toBe("LIKELY_NOT_ELIGIBLE");
  });

  it("an excluded technology is a real CONFLICT, never silently ignored", () => {
    const input = baseProfile({
      excludedTechnologies: ["PHP"],
      job: { ...baseProfile().job, technologies: ["PHP", "React"] },
    });
    const result = computeJobMatch(input);
    expect(result.dimensions.technology.status).toBe("CONFLICT");
  });
});

describe("computeJobMatch — location/relocation (§22)", () => {
  it("MISMATCH when job location is outside target geography and relocation is UNWILLING", () => {
    const input = baseProfile({
      targetCountries: ["India"],
      relocationPreference: "UNWILLING",
      job: { ...baseProfile().job, workMode: "ONSITE", country: "Germany" },
    });
    const result = computeJobMatch(input);
    expect(result.dimensions.location.status).toBe("MISMATCH");
  });

  it("PARTIAL (not MATCHED) when outside target geography but user is willing to relocate — never treated as a full match", () => {
    const input = baseProfile({
      targetCountries: ["India"],
      relocationPreference: "WILLING",
      job: { ...baseProfile().job, workMode: "ONSITE", country: "Germany" },
    });
    const result = computeJobMatch(input);
    expect(result.dimensions.location.status).toBe("PARTIAL");
  });
});
