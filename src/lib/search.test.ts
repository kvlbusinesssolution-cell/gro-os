import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { globalSearch } from "./search";

// Real local-Postgres integration test, matching this repo's established
// convention for Prisma-touching code (no mocking).
describe("globalSearch — Company domain/website matching (Phase 24 requirement #13)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Search Test Org", slug: `search-test-org-${Date.now()}` },
    });
    organizationId = org.id;
    await prisma.company.create({
      data: {
        organizationId,
        name: "Totally Unrelated Name",
        website: "https://acme-widgets.example.com",
        domain: "acme-widgets.example.com",
        source: "MANUAL",
        status: "PROSPECT",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  it("finds a Company by domain even when the name doesn't contain the search term", async () => {
    const results = await globalSearch(organizationId, "acme-widgets");
    const companyHit = results.find((r) => r.kind === "company");
    expect(companyHit).toBeDefined();
  });

  it("still finds a Company by name (existing behavior preserved)", async () => {
    const results = await globalSearch(organizationId, "Totally Unrelated");
    const companyHit = results.find((r) => r.kind === "company");
    expect(companyHit).toBeDefined();
  });
});
