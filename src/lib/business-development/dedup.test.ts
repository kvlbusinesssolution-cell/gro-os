import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { findOrCreateCompany } from "./dedup";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company created during the test).
describe("findOrCreateCompany", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Dedup Test Org", slug: `dedup-test-org-${Date.now()}` },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  it("initializes discovery tracking fields on fresh creation", async () => {
    const { company, wasCreated } = await findOrCreateCompany({
      organizationId,
      name: "Acme Fresh Co",
      website: "https://acme-fresh.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });

    expect(wasCreated).toBe(true);
    expect(company.sourceCount).toBe(1);
    expect(company.discoverySources).toEqual(["LEAD_FINDER"]);
    expect(company.lastDiscoveredAt).toBeInstanceOf(Date);
  });

  it("increments sourceCount and appends a new source on re-discovery via website match", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Website Match Co",
      website: "https://website-match.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    expect(first.wasCreated).toBe(true);

    const second = await findOrCreateCompany({
      organizationId,
      name: "Website Match Co (renamed on rediscovery)",
      website: "https://www.website-match.example.com/some/path",
      source: "AUTO_DISCOVERY",
      status: "LEAD",
    });

    expect(second.wasCreated).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(second.company.sourceCount).toBe(2);
    expect(second.company.discoverySources).toEqual(["LEAD_FINDER", "AUTO_DISCOVERY"]);
  });

  it("does not duplicate a source already present in discoverySources on re-discovery via the same source", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Same Source Co",
      website: "https://same-source.example.com",
      source: "CLIENT_FINDER",
      status: "PROSPECT",
    });
    expect(first.wasCreated).toBe(true);

    const second = await findOrCreateCompany({
      organizationId,
      name: "Same Source Co",
      website: "https://same-source.example.com",
      source: "CLIENT_FINDER",
      status: "PROSPECT",
    });

    expect(second.wasCreated).toBe(false);
    expect(second.company.sourceCount).toBe(2);
    expect(second.company.discoverySources).toEqual(["CLIENT_FINDER"]);
  });

  it("matches on name+country when a country is provided, even with no website overlap", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Country Match Co",
      headquartersCountry: "India",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    expect(first.wasCreated).toBe(true);
    await prisma.company.update({ where: { id: first.company.id }, data: { headquartersCountry: "India" } });

    const second = await findOrCreateCompany({
      organizationId,
      name: "country match co",
      headquartersCountry: "india",
      source: "AUTO_DISCOVERY",
      status: "LEAD",
    });

    expect(second.wasCreated).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(second.company.sourceCount).toBe(2);
    expect(second.company.discoverySources).toEqual(["LEAD_FINDER", "AUTO_DISCOVERY"]);
  });

  it("falls back to name-only matching when no country is supplied", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Name Only Co",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    expect(first.wasCreated).toBe(true);

    const second = await findOrCreateCompany({
      organizationId,
      name: "name only co",
      source: "AUTO_DISCOVERY",
      status: "LEAD",
    });

    expect(second.wasCreated).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(second.company.sourceCount).toBe(2);
    expect(second.company.discoverySources).toEqual(["LEAD_FINDER", "AUTO_DISCOVERY"]);
  });
});
