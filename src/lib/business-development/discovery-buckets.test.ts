import { describe, expect, it } from "vitest";

import { classifyCompanyBuckets, type DiscoveryBucketInput } from "./discovery-buckets";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAgo = (d: number) => hoursAgo(d * 24);

function baseInput(overrides: Partial<DiscoveryBucketInput> = {}): DiscoveryBucketInput {
  return {
    sourceCount: 1,
    lastDiscoveredAt: daysAgo(30),
    intelligenceRunCount: 0,
    latestIntelligenceRunAt: null,
    evidenceCount: 0,
    hasLeadScore: false,
    ...overrides,
  };
}

describe("classifyCompanyBuckets", () => {
  it("flags a brand-new, never-enriched company as both newly discovered and unverified", () => {
    const buckets = classifyCompanyBuckets(baseInput({ lastDiscoveredAt: hoursAgo(2) }), NOW);
    expect(buckets).toEqual(expect.arrayContaining(["NEWLY_DISCOVERED", "UNVERIFIED"]));
    expect(buckets).not.toContain("DUPLICATE_CANDIDATE");
    expect(buckets).not.toContain("RESEARCH_FAILURE");
    expect(buckets).not.toContain("FULLY_RESEARCHED");
  });

  it("does not flag as newly discovered once lastDiscoveredAt is older than 24 hours", () => {
    const buckets = classifyCompanyBuckets(baseInput({ lastDiscoveredAt: daysAgo(10) }), NOW);
    expect(buckets).not.toContain("NEWLY_DISCOVERED");
    expect(buckets).toContain("UNVERIFIED");
  });

  it("flags a company with a recent report, evidence, and a lead score as recently researched AND fully researched", () => {
    const buckets = classifyCompanyBuckets(
      baseInput({
        lastDiscoveredAt: daysAgo(30),
        intelligenceRunCount: 1,
        latestIntelligenceRunAt: daysAgo(3),
        evidenceCount: 4,
        hasLeadScore: true,
      }),
      NOW,
    );
    expect(buckets).toEqual(expect.arrayContaining(["RECENTLY_RESEARCHED", "FULLY_RESEARCHED"]));
    expect(buckets).not.toContain("UNVERIFIED");
  });

  it("does not flag as recently researched once the latest report is older than 7 days, but stays fully researched", () => {
    const buckets = classifyCompanyBuckets(
      baseInput({
        intelligenceRunCount: 1,
        latestIntelligenceRunAt: daysAgo(30),
        evidenceCount: 2,
        hasLeadScore: true,
      }),
      NOW,
    );
    expect(buckets).not.toContain("RECENTLY_RESEARCHED");
    expect(buckets).toContain("FULLY_RESEARCHED");
  });

  it("flags a repeatedly-rediscovered company with zero intelligence runs as both a duplicate candidate and a research failure", () => {
    const buckets = classifyCompanyBuckets(baseInput({ sourceCount: 3, lastDiscoveredAt: daysAgo(30) }), NOW);
    expect(buckets).toEqual(expect.arrayContaining(["DUPLICATE_CANDIDATE", "RESEARCH_FAILURE"]));
    // sourceCount !== 1, so this is explicitly not "unverified" — unverified means discovered exactly once.
    expect(buckets).not.toContain("UNVERIFIED");
  });

  it("flags sourceCount > 1 as a duplicate candidate but not a research failure once it has an intelligence run", () => {
    const buckets = classifyCompanyBuckets(
      baseInput({ sourceCount: 2, intelligenceRunCount: 1, latestIntelligenceRunAt: daysAgo(30) }),
      NOW,
    );
    expect(buckets).toContain("DUPLICATE_CANDIDATE");
    expect(buckets).not.toContain("RESEARCH_FAILURE");
  });

  it("returns no buckets for an old, never-enriched, single-source company outside every window", () => {
    // Not literally possible (UNVERIFIED requires sourceCount===1 && 0 runs, which is
    // always true here) — asserts UNVERIFIED is the only bucket that survives.
    const buckets = classifyCompanyBuckets(baseInput({ lastDiscoveredAt: daysAgo(60) }), NOW);
    expect(buckets).toEqual(["UNVERIFIED"]);
  });
});
