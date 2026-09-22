import { describe, expect, it } from "vitest";

import { buildCompanyDiscoveryWhere, parseNumberParam, toStringArray } from "./company-discovery-filters";
import { buildDiscoveryBucketWhere, type DiscoveryBucket } from "./discovery-buckets";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const ORG_A = "org_a";

describe("toStringArray", () => {
  it("returns [] for undefined", () => {
    expect(toStringArray(undefined)).toEqual([]);
  });
  it("wraps a single string", () => {
    expect(toStringArray("India")).toEqual(["India"]);
  });
  it("passes through an array and drops empty entries", () => {
    expect(toStringArray(["India", "", "  ", "UAE"])).toEqual(["India", "UAE"]);
  });
});

describe("parseNumberParam", () => {
  it("returns undefined for empty/missing input", () => {
    expect(parseNumberParam(undefined)).toBeUndefined();
    expect(parseNumberParam("")).toBeUndefined();
    expect(parseNumberParam("   ")).toBeUndefined();
  });
  it("returns undefined for non-numeric input rather than NaN", () => {
    expect(parseNumberParam("abc")).toBeUndefined();
  });
  it("parses a valid number", () => {
    expect(parseNumberParam("50")).toBe(50);
  });
});

describe("buildCompanyDiscoveryWhere", () => {
  it("always scopes to the organization, even with no other filters", () => {
    const where = buildCompanyDiscoveryWhere(ORG_A, {}, buildDiscoveryBucketWhere, NOW);
    expect(where).toEqual({ AND: [{ organizationId: ORG_A }] });
  });

  it("OR: multiple industries combine via `in`, not `AND` of each value", () => {
    const where = buildCompanyDiscoveryWhere(ORG_A, { industries: ["SaaS", "Software"] }, buildDiscoveryBucketWhere, NOW);
    expect(where).toEqual({ AND: [{ organizationId: ORG_A }, { industry: { in: ["SaaS", "Software"] } }] });
  });

  it("OR: multiple countries combine via `in`", () => {
    const where = buildCompanyDiscoveryWhere(ORG_A, { countries: ["India", "UAE"] }, buildDiscoveryBucketWhere, NOW);
    expect(where).toEqual({ AND: [{ organizationId: ORG_A }, { headquartersCountry: { in: ["India", "UAE"] } }] });
  });

  it("NOT: technologyMode=exclude produces a real negation, not a positive match", () => {
    const where = buildCompanyDiscoveryWhere(
      ORG_A,
      { technology: "Shopify", technologyMode: "exclude" },
      buildDiscoveryBucketWhere,
      NOW,
    );
    expect(where).toEqual({ AND: [{ organizationId: ORG_A }, { NOT: { technologies: { has: "Shopify" } } }] });
  });

  it("include mode (default) produces a positive `has` match", () => {
    const where = buildCompanyDiscoveryWhere(ORG_A, { technology: "Shopify", technologyMode: "include" }, buildDiscoveryBucketWhere, NOW);
    expect(where).toEqual({ AND: [{ organizationId: ORG_A }, { technologies: { has: "Shopify" } }] });
  });

  it("AND: employee range, revenue range, funding stage, state and city all combine together", () => {
    const where = buildCompanyDiscoveryWhere(
      ORG_A,
      {
        employeeMin: 50,
        employeeMax: 500,
        revenueMin: 100000,
        fundingStage: "Series A",
        state: "Maharashtra",
        city: "Pune",
      },
      buildDiscoveryBucketWhere,
      NOW,
    );
    expect(where).toEqual({
      AND: [
        { organizationId: ORG_A },
        { employeeCount: { gte: 50, lte: 500 } },
        { estimatedRevenue: { gte: 100000 } },
        { fundingStage: "Series A" },
        { headquartersState: "Maharashtra" },
        { headquartersCity: { contains: "Pune", mode: "insensitive" } },
      ],
    });
  });

  it("only includes the employeeCount clause when at least one bound is set", () => {
    const where = buildCompanyDiscoveryWhere(ORG_A, {}, buildDiscoveryBucketWhere, NOW);
    const hasEmployeeClause = (where.AND as object[]).some((c) => "employeeCount" in c);
    expect(hasEmployeeClause).toBe(false);
  });

  it("combines a discovery-bucket status filter with the rest via real AND", () => {
    const bucket: DiscoveryBucket = "UNVERIFIED";
    const where = buildCompanyDiscoveryWhere(ORG_A, { statusFilter: bucket, city: "Pune" }, buildDiscoveryBucketWhere, NOW);
    const conditions = where.AND as object[];
    expect(conditions).toContainEqual({ organizationId: ORG_A });
    expect(conditions).toContainEqual({ headquartersCity: { contains: "Pune", mode: "insensitive" } });
    expect(conditions).toContainEqual(buildDiscoveryBucketWhere(bucket, NOW));
  });
});
