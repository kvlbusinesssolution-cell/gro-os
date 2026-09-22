import { describe, expect, it } from "vitest";

import { classifyEvidenceFreshness } from "./evidence-freshness";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("classifyEvidenceFreshness", () => {
  it("is FRESH just after discovery", () => {
    expect(classifyEvidenceFreshness(daysAgo(0), NOW)).toBe("FRESH");
  });

  it("is FRESH well under the default threshold (60 days)", () => {
    expect(classifyEvidenceFreshness(daysAgo(20), NOW)).toBe("FRESH");
  });

  it("is AGING once past half the default threshold", () => {
    expect(classifyEvidenceFreshness(daysAgo(35), NOW)).toBe("AGING");
  });

  it("is STALE once past the default threshold (60 days)", () => {
    expect(classifyEvidenceFreshness(daysAgo(61), NOW)).toBe("STALE");
  });

  it("uses the shorter high-value threshold (14 days) for a high-value company", () => {
    expect(classifyEvidenceFreshness(daysAgo(20), NOW, true)).toBe("STALE");
    expect(classifyEvidenceFreshness(daysAgo(6), NOW, true)).toBe("FRESH");
    expect(classifyEvidenceFreshness(daysAgo(10), NOW, true)).toBe("AGING");
  });

  it("never returns STALE for the exact same instant regardless of company value", () => {
    expect(classifyEvidenceFreshness(NOW, NOW, false)).toBe("FRESH");
    expect(classifyEvidenceFreshness(NOW, NOW, true)).toBe("FRESH");
  });
});
