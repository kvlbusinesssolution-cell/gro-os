import { describe, expect, it } from "vitest";

import { buildDecisionMakerSearchWhere } from "./decision-maker-search";

const ORG_A = "org_a";

describe("buildDecisionMakerSearchWhere", () => {
  it("always scopes to the organization via the company relation, even with no other filters", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, {});
    expect(where).toEqual({ AND: [{ company: { organizationId: ORG_A } }] });
  });

  it("OR: multiple roles combine via `in`", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, { roles: ["CEO", "CTO"] });
    expect(where).toEqual({ AND: [{ company: { organizationId: ORG_A } }, { role: { in: ["CEO", "CTO"] } }] });
  });

  it("OR: multiple industries filter through the company relation", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, { industries: ["SaaS", "Fintech"] });
    expect(where).toEqual({
      AND: [{ company: { organizationId: ORG_A } }, { company: { industry: { in: ["SaaS", "Fintech"] } } }],
    });
  });

  it("name search is case-insensitive contains, never an exact-only match", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, { name: "sharma" });
    expect(where).toEqual({
      AND: [{ company: { organizationId: ORG_A } }, { name: { contains: "sharma", mode: "insensitive" } }],
    });
  });

  it("minConfidence produces a real `gte` filter, never a fabricated cutoff applied client-side", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, { minConfidence: 0.7 });
    expect(where).toEqual({ AND: [{ company: { organizationId: ORG_A } }, { confidence: { gte: 0.7 } }] });
  });

  it("combines name + role + country filters all via real AND", () => {
    const where = buildDecisionMakerSearchWhere(ORG_A, { name: "Kumar", roles: ["CEO"], countries: ["India"] });
    expect(where).toEqual({
      AND: [
        { company: { organizationId: ORG_A } },
        { name: { contains: "Kumar", mode: "insensitive" } },
        { role: { in: ["CEO"] } },
        { company: { headquartersCountry: { in: ["India"] } } },
      ],
    });
  });
});
