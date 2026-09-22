import { describe, expect, it } from "vitest";

import { buildContactSearchWhere } from "./contact-search-filters";

describe("buildContactSearchWhere", () => {
  it("always scopes to the organization and excludes merged-away contacts", () => {
    const where = buildContactSearchWhere("org-1", {});
    expect(where.organizationId).toBe("org-1");
    expect(where.mergedIntoId).toBeNull();
  });

  it("applies job title, department, seniority, location, and buyer-role filters when supplied", () => {
    const where = buildContactSearchWhere("org-1", {
      jobTitle: "Engineer",
      department: "Engineering",
      seniority: "Director",
      country: "India",
      city: "Bengaluru",
      buyerRole: "TECHNICAL_BUYER",
      companyId: "company-1",
    });

    expect(where.jobTitle).toEqual({ contains: "Engineer", mode: "insensitive" });
    expect(where.department).toEqual({ contains: "Engineering", mode: "insensitive" });
    expect(where.seniority).toEqual({ contains: "Director", mode: "insensitive" });
    expect(where.country).toEqual({ equals: "India", mode: "insensitive" });
    expect(where.city).toEqual({ equals: "Bengaluru", mode: "insensitive" });
    expect(where.buyerRole).toBe("TECHNICAL_BUYER");
    expect(where.companyId).toBe("company-1");
  });

  it("omits a filter key entirely when the input is empty/whitespace, rather than filtering on an empty string", () => {
    const where = buildContactSearchWhere("org-1", { jobTitle: "  ", department: "" });
    expect(where.jobTitle).toBeUndefined();
    expect(where.department).toBeUndefined();
  });
});
