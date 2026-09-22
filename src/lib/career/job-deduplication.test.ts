import { describe, expect, it } from "vitest";

import { findDuplicateJob, type DedupCandidate, type DedupInput } from "./job-deduplication";

function baseInput(overrides: Partial<DedupInput> = {}): DedupInput {
  return {
    provider: "Remotive",
    sourceJobId: "123",
    canonicalUrl: "https://remotive.com/remote-jobs/123",
    company: "Acme",
    title: "Senior React Developer",
    location: "USA",
    description: "We need a senior React developer with 5 years of experience building web applications.",
    postingDate: new Date("2026-09-01"),
    ...overrides,
  };
}
function baseCandidate(overrides: Partial<DedupCandidate> = {}): DedupCandidate {
  return {
    jobId: "job-1",
    provider: "Remotive",
    sourceJobId: "123",
    canonicalUrl: "https://remotive.com/remote-jobs/123",
    company: "Acme",
    title: "Senior React Developer",
    location: "USA",
    description: "We need a senior React developer with 5 years of experience building web applications.",
    postingDate: new Date("2026-09-01"),
    ...overrides,
  };
}

describe("findDuplicateJob — §8 real identity hierarchy", () => {
  it("matches via same provider + source job ID (strongest signal)", () => {
    const result = findDuplicateJob(baseInput(), [baseCandidate({ jobId: "job-1", canonicalUrl: null, title: "Different Title Entirely" })]);
    expect(result.duplicateOfJobId).toBe("job-1");
    expect(result.matchedBy).toBe("SOURCE_ID");
  });

  it("matches via same canonicalUrl when source job IDs differ", () => {
    const result = findDuplicateJob(baseInput({ sourceJobId: "999" }), [baseCandidate({ sourceJobId: "123" })]);
    expect(result.matchedBy).toBe("CANONICAL_URL");
  });

  it("matches via normalized company+title+location when neither ID nor URL match", () => {
    const result = findDuplicateJob(
      baseInput({ sourceJobId: "999", canonicalUrl: null }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other" })],
    );
    expect(result.matchedBy).toBe("COMPANY_TITLE_LOCATION");
  });

  it("does NOT merge jobs with the same title at different locations (§8: different locations may be different jobs)", () => {
    const result = findDuplicateJob(
      baseInput({ sourceJobId: "999", canonicalUrl: null, location: "Germany" }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other", location: "USA" })],
    );
    expect(result.duplicateOfJobId).toBeNull();
  });

  it("does NOT merge different companies with the identical title (§8: different companies may have identical titles)", () => {
    const result = findDuplicateJob(
      baseInput({ sourceJobId: "999", canonicalUrl: null, company: "OtherCo" }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other" })],
    );
    expect(result.duplicateOfJobId).toBeNull();
  });

  it("matches via strong description similarity + same company + nearby posting date, as a real last-resort signal", () => {
    const result = findDuplicateJob(
      baseInput({
        sourceJobId: "999",
        canonicalUrl: null,
        title: "Senior React Engineer", // slightly different title
        postingDate: new Date("2026-09-05"), // 4 days later — within the real 14-day window
      }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other" })],
    );
    expect(result.matchedBy).toBe("DESCRIPTION_SIMILARITY");
  });

  it("does NOT merge on weak description similarity alone, even from the same company", () => {
    const result = findDuplicateJob(
      baseInput({
        sourceJobId: "999",
        canonicalUrl: null,
        title: "Backend Python Developer",
        description: "We are hiring a Python backend engineer to build our payments infrastructure using Django.",
      }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other" })],
    );
    expect(result.duplicateOfJobId).toBeNull();
  });

  it("does NOT merge on description similarity when posting dates are far apart (>14 real days) — likely a genuinely re-posted, distinct opening", () => {
    const result = findDuplicateJob(
      baseInput({
        sourceJobId: "999",
        canonicalUrl: null,
        title: "Senior React Engineer", // slightly different title, so stage 3 (exact title match) doesn't short-circuit this test
        postingDate: new Date("2026-10-01"), // 30 days later — outside the real 14-day window
      }),
      [baseCandidate({ sourceJobId: "123", canonicalUrl: "https://example.com/other" })],
    );
    expect(result.duplicateOfJobId).toBeNull();
  });

  it("returns no duplicate when there are no candidates at all", () => {
    const result = findDuplicateJob(baseInput(), []);
    expect(result.duplicateOfJobId).toBeNull();
    expect(result.matchedBy).toBeNull();
  });
});
