import { describe, expect, it } from "vitest";

import {
  barWidthPct,
  COMPANY_SOURCE_LABEL,
  filterBreakdownRows,
  formatDateRangeLabel,
  maxCount,
  parseAcquisitionDateRange,
  sortBreakdownRows,
} from "./acquisition-display";

describe("COMPANY_SOURCE_LABEL", () => {
  it("has a label for every real CompanySource value", () => {
    for (const source of ["MANUAL", "LEAD_FINDER", "CLIENT_FINDER", "WEBSITE_SCANNER", "AUTO_DISCOVERY", "REFERRAL"] as const) {
      expect(COMPANY_SOURCE_LABEL[source]).toBeTruthy();
    }
  });
});

describe("parseAcquisitionDateRange", () => {
  it("returns undefined (all-time) when neither bound is set", () => {
    expect(parseAcquisitionDateRange(undefined, undefined)).toBeUndefined();
    expect(parseAcquisitionDateRange("", "")).toBeUndefined();
  });

  it("parses a full from/to range, with `to` inclusive of the whole day", () => {
    const range = parseAcquisitionDateRange("2026-01-01", "2026-01-31");
    expect(range).toBeDefined();
    expect(range!.from.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(range!.to.toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(range!.to.getUTCHours()).toBe(23);
  });

  it("defaults a missing `from` to the epoch, reading as 'since to'", () => {
    const range = parseAcquisitionDateRange(undefined, "2026-01-31");
    expect(range).toBeDefined();
    expect(range!.from.getTime()).toBe(0);
  });

  it("defaults a missing `to` to now, reading as 'since from'", () => {
    const before = Date.now();
    const range = parseAcquisitionDateRange("2026-01-01", undefined);
    expect(range).toBeDefined();
    expect(range!.to.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("returns undefined for an unparseable date", () => {
    expect(parseAcquisitionDateRange("not-a-date", "2026-01-31")).toBeUndefined();
  });

  it("returns undefined when from is after to", () => {
    expect(parseAcquisitionDateRange("2026-02-01", "2026-01-01")).toBeUndefined();
  });
});

describe("formatDateRangeLabel", () => {
  it("returns 'All time' when no range is set", () => {
    expect(formatDateRangeLabel(undefined)).toBe("All time");
  });

  it("formats a real range as 'From – To'", () => {
    const label = formatDateRangeLabel({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-31T23:59:59Z") });
    expect(label).toContain("–");
    expect(label).toContain("2026");
  });
});

describe("filterBreakdownRows", () => {
  const rows = [{ source: "Website Scanner", count: 3 }, { source: "Referral", count: 1 }];

  it("returns every row for an empty query", () => {
    expect(filterBreakdownRows(rows, "", "source")).toHaveLength(2);
    expect(filterBreakdownRows(rows, "   ", "source")).toHaveLength(2);
  });

  it("filters case-insensitively by substring on the given key", () => {
    expect(filterBreakdownRows(rows, "web", "source")).toEqual([{ source: "Website Scanner", count: 3 }]);
    expect(filterBreakdownRows(rows, "REFERRAL", "source")).toEqual([{ source: "Referral", count: 1 }]);
    expect(filterBreakdownRows(rows, "nope", "source")).toEqual([]);
  });
});

describe("sortBreakdownRows", () => {
  const rows = [
    { source: "Referral", revenue: 100 },
    { source: "Website Scanner", revenue: 300 },
    { source: "Manual", revenue: 200 },
  ];

  it("sorts numeric columns numerically", () => {
    expect(sortBreakdownRows(rows, "revenue", "asc").map((r) => r.revenue)).toEqual([100, 200, 300]);
    expect(sortBreakdownRows(rows, "revenue", "desc").map((r) => r.revenue)).toEqual([300, 200, 100]);
  });

  it("sorts text columns via localeCompare", () => {
    expect(sortBreakdownRows(rows, "source", "asc").map((r) => r.source)).toEqual(["Manual", "Referral", "Website Scanner"]);
  });

  it("never mutates the input array", () => {
    const copy = [...rows];
    sortBreakdownRows(rows, "revenue", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("maxCount", () => {
  it("returns at least 1 even for all-zero or empty input", () => {
    expect(maxCount([])).toBe(1);
    expect(maxCount([0, 0])).toBe(1);
  });

  it("returns the real maximum otherwise", () => {
    expect(maxCount([3, 7, 2])).toBe(7);
  });
});

describe("barWidthPct", () => {
  it("returns 0 for a zero count", () => {
    expect(barWidthPct(0, 10)).toBe(0);
  });

  it("floors a nonzero count's bar to at least 4%", () => {
    expect(barWidthPct(1, 1000)).toBe(4);
  });

  it("returns the real percentage when it's above the floor", () => {
    expect(barWidthPct(5, 10)).toBe(50);
  });
});
