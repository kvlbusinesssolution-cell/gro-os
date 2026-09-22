import { describe, expect, it } from "vitest";

import { validateCustomizedResume, type CustomizedResumeContent, type SourceProfileForCustomization } from "./resume-customization";

function source(overrides: Partial<SourceProfileForCustomization> = {}): SourceProfileForCustomization {
  return {
    skills: ["React", "TypeScript", "Node.js"],
    projects: ["Internal Dashboard Rebuild"],
    achievements: ["Reduced page load time by 40%"],
    companies: ["Acme Corp"],
    currentRole: "Senior Frontend Engineer",
    yearsOfExperience: 5,
    targetRole: "Senior React Developer",
    ...overrides,
  };
}

function content(overrides: Partial<CustomizedResumeContent> = {}): CustomizedResumeContent {
  return {
    summary: "Experienced frontend engineer with a strong React background.",
    emphasizedSkills: ["React", "TypeScript"],
    highlightedProjects: ["Internal Dashboard Rebuild"],
    highlightedAchievements: ["Reduced page load time by 40%"],
    ...overrides,
  };
}

describe("validateCustomizedResume — §10 real fabrication detection", () => {
  it("passes (not blocked) when every structured field is a genuine subset of the real source data", () => {
    const result = validateCustomizedResume(content(), source());
    expect(result.blocked).toBe(false);
    expect(result.unsupportedClaims).toHaveLength(0);
  });

  it("BLOCKS a fabricated skill not present anywhere in the verified profile (§9/§10 — never add a skill)", () => {
    const result = validateCustomizedResume(content({ emphasizedSkills: ["React", "Kubernetes"] }), source());
    expect(result.blocked).toBe(true);
    expect(result.unsupportedClaims.some((c) => c.includes("Kubernetes"))).toBe(true);
  });

  it("BLOCKS a fabricated project not in the real project list", () => {
    const result = validateCustomizedResume(content({ highlightedProjects: ["A Project That Never Existed"] }), source());
    expect(result.blocked).toBe(true);
    expect(result.unsupportedClaims.some((c) => c.toLowerCase().includes("project"))).toBe(true);
  });

  it("BLOCKS a fabricated achievement not in the real achievements list", () => {
    const result = validateCustomizedResume(content({ highlightedAchievements: ["Grew revenue 300% single-handedly"] }), source());
    expect(result.blocked).toBe(true);
  });

  it("is case-insensitive when matching real source items (never a false-positive block on casing alone)", () => {
    const result = validateCustomizedResume(content({ emphasizedSkills: ["react", "TYPESCRIPT"] }), source());
    expect(result.blocked).toBe(false);
  });

  it("flags (but never auto-blocks) a summary mentioning a company name absent from the verified source — free text can only be heuristically screened, always surfaced for human review", () => {
    const result = validateCustomizedResume(content({ summary: "Previously led engineering at Fabricated Startup Inc." }), source());
    expect(result.blocked).toBe(false); // structured fields are clean
    expect(result.needsManualReview).toBe(true);
  });

  it("does not flag a clean summary that only references real, known terms", () => {
    const result = validateCustomizedResume(content({ summary: "Senior engineer skilled in React and TypeScript, previously at Acme Corp." }), source());
    expect(result.needsManualReview).toBe(false);
  });
});
