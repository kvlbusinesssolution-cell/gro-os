import { describe, expect, it } from "vitest";

import { computeCareerProfileCompleteness } from "./profile-completeness";

const EMPTY = {
  currentRole: null,
  location: null,
  yearsOfExperience: null,
  skills: null,
  education: null,
  experienceHasResume: false,
  githubUrl: null,
  linkedinUrl: null,
  websiteUrl: null,
  portfolioUrl: null,
  targetRoles: [],
  industries: [],
};

describe("computeCareerProfileCompleteness", () => {
  it("is 0% for a fully empty profile — never a fabricated baseline score", () => {
    const result = computeCareerProfileCompleteness(EMPTY);
    expect(result.score).toBe(0);
    expect(result.missingSections.length).toBe(7);
  });

  it("is 100% only when every real section has real data", () => {
    const result = computeCareerProfileCompleteness({
      currentRole: "Senior Engineer",
      location: "Pune, India",
      yearsOfExperience: 5,
      skills: [{ name: "React" }],
      education: [{ degree: "B.Tech" }],
      experienceHasResume: true,
      githubUrl: "https://github.com/x",
      linkedinUrl: null,
      websiteUrl: null,
      portfolioUrl: null,
      targetRoles: ["Senior React Developer"],
      industries: ["SaaS"],
    });
    expect(result.score).toBe(100);
    expect(result.missingSections).toEqual([]);
  });

  it("does not count a section complete from an empty array or empty string", () => {
    const result = computeCareerProfileCompleteness({
      ...EMPTY,
      currentRole: "   ", // whitespace only — not real content
      skills: [],
      targetRoles: [],
    });
    expect(result.sections.find((s) => s.section.startsWith("Identity"))?.complete).toBe(false);
    expect(result.sections.find((s) => s.section === "Skills")?.complete).toBe(false);
  });

  it("only counts Links complete when at least one real URL is present", () => {
    const withLink = computeCareerProfileCompleteness({ ...EMPTY, linkedinUrl: "https://linkedin.com/in/x" });
    const withoutLink = computeCareerProfileCompleteness(EMPTY);
    expect(withLink.sections.find((s) => s.section.startsWith("Links"))?.complete).toBe(true);
    expect(withoutLink.sections.find((s) => s.section.startsWith("Links"))?.complete).toBe(false);
  });

  it("requires resume presence as its own real, non-inferred section", () => {
    const noResume = computeCareerProfileCompleteness(EMPTY);
    const withResume = computeCareerProfileCompleteness({ ...EMPTY, experienceHasResume: true });
    expect(noResume.sections.find((s) => s.section === "Resume on file")?.complete).toBe(false);
    expect(withResume.sections.find((s) => s.section === "Resume on file")?.complete).toBe(true);
  });
});
