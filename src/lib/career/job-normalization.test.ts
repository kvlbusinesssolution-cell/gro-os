import { describe, expect, it } from "vitest";

import { normalizeJob } from "./job-normalization";
import type { RawJobResult } from "./job-providers/types";

function rawJob(overrides: Partial<RawJobResult> = {}): RawJobResult {
  return {
    sourceJobId: "1",
    sourceUrl: "https://remotive.com/remote-jobs/1",
    canonicalUrl: "https://remotive.com/remote-jobs/1",
    title: "Senior React Developer",
    company: "Acme",
    location: "USA",
    description: "Real job description.",
    technologies: ["react", "typescript"],
    salaryText: null,
    postingDate: null,
    rawSnapshot: {},
    ...overrides,
  };
}

describe("normalizeJob — real, deterministic, documented heuristics (§7)", () => {
  it("parses a simple 'min-max' salary range with a real currency symbol", () => {
    const result = normalizeJob(rawJob({ salaryText: "$90k - $105k" }), "Remotive");
    expect(result.salaryMin).toBe(90000);
    expect(result.salaryMax).toBe(105000);
    expect(result.salaryCurrency).toBe("USD");
  });

  it("leaves salary null (never estimated) when the text doesn't match a real parseable pattern", () => {
    const result = normalizeJob(rawJob({ salaryText: "Competitive" }), "Remotive");
    expect(result.salaryMin).toBeNull();
    expect(result.salaryMax).toBeNull();
  });

  it("leaves salary null when no salary text was provided at all", () => {
    const result = normalizeJob(rawJob({ salaryText: null }), "Remotive");
    expect(result.salaryMin).toBeNull();
  });

  it("detects a real career-level keyword from the title", () => {
    expect(normalizeJob(rawJob({ title: "Senior Backend Engineer" }), "Remotive").careerLevel).toBe("Senior");
    expect(normalizeJob(rawJob({ title: "Junior Developer" }), "Remotive").careerLevel).toBe("Junior");
    expect(normalizeJob(rawJob({ title: "Staff Engineer" }), "Remotive").careerLevel).toBe("Staff");
  });

  it("leaves careerLevel null (never guessed) when the title has no real level keyword", () => {
    expect(normalizeJob(rawJob({ title: "Software Engineer" }), "Remotive").careerLevel).toBeNull();
  });

  it("marks Remotive jobs REMOTE as a real fact about the source, not an inference", () => {
    expect(normalizeJob(rawJob(), "Remotive").workMode).toBe("REMOTE");
  });

  it("never rewrites the real original source title — sourceTitle stays untouched", () => {
    const result = normalizeJob(rawJob({ title: "  Senior React Developer  " }), "Remotive");
    expect(result.title).toBe("Senior React Developer"); // trimmed
    expect(result.sourceTitle).toBe("  Senior React Developer  "); // real original preserved verbatim
  });

  it("treats a vague 'Worldwide' location as genuinely unknown country, never a guessed one", () => {
    const result = normalizeJob(rawJob({ location: "Worldwide" }), "Remotive");
    expect(result.country).toBeNull();
  });

  it("extracts the first real listed country from a simple comma-separated location string", () => {
    const result = normalizeJob(rawJob({ location: "USA, Canada, Mexico" }), "Remotive");
    expect(result.country).toBe("USA");
  });
});
