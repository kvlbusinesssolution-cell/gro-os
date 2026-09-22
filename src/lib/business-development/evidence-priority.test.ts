import { describe, expect, it } from "vitest";

import { resolveFieldConflict, sourcePriority } from "./evidence-priority";

describe("sourcePriority", () => {
  it("ranks MANUAL highest and COMPANY_INTELLIGENCE (AI-derived) lowest", () => {
    expect(sourcePriority("MANUAL")).toBeGreaterThan(sourcePriority("CSV_IMPORT"));
    expect(sourcePriority("CSV_IMPORT")).toBeGreaterThan(sourcePriority("WEBSITE_SCAN"));
    expect(sourcePriority("WEBSITE_SCAN")).toBeGreaterThan(sourcePriority("WEB_SEARCH"));
    expect(sourcePriority("WEB_SEARCH")).toBeGreaterThan(sourcePriority("COMPANY_INTELLIGENCE"));
  });
});

describe("resolveFieldConflict — Phase 24 requirement #6/#7 (source priority, conflicting sources)", () => {
  it("always applies when there is no prior evidence for the field", () => {
    const result = resolveFieldConflict("WEB_SEARCH", []);
    expect(result.shouldApplyToCompanyField).toBe(true);
  });

  it("applies a higher-priority new source over a lower-priority existing one", () => {
    const result = resolveFieldConflict("MANUAL", [{ source: "WEB_SEARCH" }]);
    expect(result.shouldApplyToCompanyField).toBe(true);
  });

  it("does NOT apply a lower-priority new source over a higher-priority existing one — real conflict scenario (e.g. conflicting employee count)", () => {
    const result = resolveFieldConflict("COMPANY_INTELLIGENCE", [{ source: "MANUAL" }]);
    expect(result.shouldApplyToCompanyField).toBe(false);
    expect(result.reason).toMatch(/lower-priority/);
  });

  it("applies when the new source matches the highest existing priority (tie goes to the new write)", () => {
    const result = resolveFieldConflict("WEBSITE_SCAN", [{ source: "WEBSITE_SCAN" }]);
    expect(result.shouldApplyToCompanyField).toBe(true);
  });

  it("compares against the HIGHEST existing priority when multiple prior sources exist", () => {
    const result = resolveFieldConflict("WEB_SEARCH", [{ source: "COMPANY_INTELLIGENCE" }, { source: "MANUAL" }]);
    // MANUAL (100) outranks the new WEB_SEARCH (60) even though a lower-
    // priority COMPANY_INTELLIGENCE row also exists for this field.
    expect(result.shouldApplyToCompanyField).toBe(false);
  });
});
