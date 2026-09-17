import type { CompanySource } from "@/generated/prisma/enums";

/**
 * Pure display/formatting + sort/filter helpers for the "Acquisition
 * Overview" section of /dashboard/analytics (backed by
 * `computeAcquisitionOverview`, see src/lib/analytics/acquisition-funnel.ts).
 * Kept free of Prisma calls / React so they can be unit-tested in isolation
 * (see acquisition-display.test.ts) — mirrors the same split already used by
 * opportunity-display.ts and referral-partner-display.ts between pure
 * classification/formatting logic and the page that queries Postgres.
 */

/** Human-readable label for each real `CompanySource` value. */
export const COMPANY_SOURCE_LABEL: Record<CompanySource, string> = {
  MANUAL: "Manual",
  LEAD_FINDER: "Lead Finder",
  CLIENT_FINDER: "Client Finder",
  WEBSITE_SCANNER: "Website Scanner",
  AUTO_DISCOVERY: "Auto Discovery",
  REFERRAL: "Referral",
};

export interface AcquisitionDateRange {
  from: Date;
  to: Date;
}

/**
 * Parses the page's `?from=YYYY-MM-DD&to=YYYY-MM-DD` search params into the
 * `{ from, to }` range `computeAcquisitionOverview` expects — same
 * `type="date"` input + `new Date(...)`/`new Date(`${to}T23:59:59.999Z`)`
 * convention already used by the company-discovery filter form
 * (src/app/dashboard/company-discovery/page.tsx), reused here rather than
 * inventing a second date-range convention.
 *
 * Either bound may be supplied alone — a missing `from` defaults to the
 * Unix epoch, a missing `to` defaults to "now" — so "from only" reads as
 * "since that date" and "to only" reads as "up to that date". Returns
 * `undefined` (all-time, no filter) when neither param is set, either value
 * fails to parse, or `from` is after `to`.
 */
export function parseAcquisitionDateRange(from: string | undefined, to: string | undefined): AcquisitionDateRange | undefined {
  const fromTrimmed = from?.trim();
  const toTrimmed = to?.trim();
  if (!fromTrimmed && !toTrimmed) return undefined;

  const fromDate = fromTrimmed ? new Date(fromTrimmed) : new Date(0);
  const toDate = toTrimmed ? new Date(`${toTrimmed}T23:59:59.999Z`) : new Date();

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return undefined;
  if (fromDate.getTime() > toDate.getTime()) return undefined;

  return { from: fromDate, to: toDate };
}

/** "All time" when no range is set, otherwise a short localized "From – To" label. */
export function formatDateRangeLabel(range: AcquisitionDateRange | undefined): string {
  if (!range) return "All time";
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}

/**
 * Case-insensitive substring filter over a single text column — used by the
 * bySource/byIndustry/byCountry/byService breakdown tables. An empty/
 * whitespace-only query returns every row unchanged.
 */
export function filterBreakdownRows<Row extends Record<string, unknown>>(rows: Row[], query: string, key: keyof Row): Row[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return rows;
  return rows.filter((row) => String(row[key] ?? "").toLowerCase().includes(trimmed));
}

/**
 * Stable sort by any column of a breakdown row — numeric columns (counts,
 * revenue) sort numerically, everything else (source/industry/country/
 * service names) sorts via localeCompare. Never mutates the input array.
 */
export function sortBreakdownRows<Row extends Record<string, unknown>>(rows: Row[], key: keyof Row, direction: "asc" | "desc"): Row[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av ?? "").localeCompare(String(bv ?? ""));
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * Widest-bar-first denominator for the funnel/bar visualizations on this
 * page — same "never divide by zero, never show a 0%-width bar for a
 * nonzero count" convention already inlined per-section in page.tsx
 * (`maxFunnel`, `maxLeaderboard`, etc.), pulled out here once since the
 * acquisition funnel is the one new chart this feature adds.
 */
export function maxCount(counts: number[]): number {
  return Math.max(1, ...counts);
}

/** Bar width percentage for a funnel/bar-chart value, with a visible minimum floor for any nonzero count. */
export function barWidthPct(count: number, max: number): number {
  return Math.max((count / max) * 100, count > 0 ? 4 : 0);
}
