import type { CompanySource, Prisma } from "@/generated/prisma/client";

/**
 * Phase 15 (Advanced B2B Data & Prospecting Engine) — real, server-side
 * filter-building for the Company Discovery page. Extracted into a pure,
 * testable function (same "headless core" discipline as
 * addOpportunityToCrmCore/advanceSequenceCore elsewhere in this codebase)
 * rather than inlined in the page component, so the boolean AND/OR/NOT
 * logic can be unit-tested without a request/DB round trip.
 *
 * AND: every non-empty filter is combined with every other via `AND`.
 * OR: `industry`/`country` each accept MULTIPLE values (a real native
 *     multi-select in the UI) — matching companies in ANY of the selected
 *     values, via Prisma's `{ in: [...] }`.
 * NOT: `technologyMode: "exclude"` negates the technology filter via a
 *     real `NOT` clause — companies that do NOT have the given technology.
 *
 * Every field filtered here already exists on the real Company model
 * (employeeCount, estimatedRevenue, fundingStage, headquartersState/City) —
 * this only surfaces them as real query filters; no new data is invented.
 */

export interface CompanyDiscoveryFilterInput {
  statusFilter?: import("./discovery-buckets").DiscoveryBucket;
  industries?: string[];
  countries?: string[];
  source?: string;
  technology?: string;
  technologyMode?: "include" | "exclude";
  employeeMin?: number;
  employeeMax?: number;
  revenueMin?: number;
  revenueMax?: number;
  fundingStage?: string;
  state?: string;
  city?: string;
  from?: Date;
  to?: Date;
}

/** Parses a string form-field value into a finite number, or undefined for empty/invalid input — never NaN leaking into a query. */
export function parseNumberParam(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalizes a searchParams value that may arrive as a single string, an array (repeated query key), or undefined into a clean string[] with empties dropped. */
export function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => v.trim()).filter((v) => v.length > 0);
}

export function buildCompanyDiscoveryWhere(
  organizationId: string,
  input: CompanyDiscoveryFilterInput,
  buildDiscoveryBucketWhere: (bucket: import("./discovery-buckets").DiscoveryBucket, now: Date) => Prisma.CompanyWhereInput,
  now: Date,
): Prisma.CompanyWhereInput {
  const conditions: Prisma.CompanyWhereInput[] = [{ organizationId }];

  if (input.statusFilter) conditions.push(buildDiscoveryBucketWhere(input.statusFilter, now));

  // OR within a dimension: real Prisma `in`, never fabricated matching.
  if (input.countries && input.countries.length > 0) conditions.push({ headquartersCountry: { in: input.countries } });
  if (input.industries && input.industries.length > 0) conditions.push({ industry: { in: input.industries } });

  if (input.source) {
    conditions.push({ OR: [{ source: input.source as CompanySource }, { discoverySources: { has: input.source } }] });
  }

  // NOT: real negation, not a UI-only exclusion.
  if (input.technology) {
    conditions.push(
      input.technologyMode === "exclude" ? { NOT: { technologies: { has: input.technology } } } : { technologies: { has: input.technology } },
    );
  }

  if (input.employeeMin !== undefined || input.employeeMax !== undefined) {
    conditions.push({
      employeeCount: {
        ...(input.employeeMin !== undefined ? { gte: input.employeeMin } : {}),
        ...(input.employeeMax !== undefined ? { lte: input.employeeMax } : {}),
      },
    });
  }

  if (input.revenueMin !== undefined || input.revenueMax !== undefined) {
    conditions.push({
      estimatedRevenue: {
        ...(input.revenueMin !== undefined ? { gte: input.revenueMin } : {}),
        ...(input.revenueMax !== undefined ? { lte: input.revenueMax } : {}),
      },
    });
  }

  if (input.fundingStage) conditions.push({ fundingStage: input.fundingStage });
  if (input.state) conditions.push({ headquartersState: input.state });
  if (input.city) conditions.push({ headquartersCity: { contains: input.city, mode: "insensitive" } });

  if (input.from) conditions.push({ lastDiscoveredAt: { gte: input.from } });
  if (input.to) conditions.push({ lastDiscoveredAt: { lte: input.to } });

  return { AND: conditions };
}
