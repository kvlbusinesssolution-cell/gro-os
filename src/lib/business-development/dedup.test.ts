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

  // Phase 24 (requirement #1/#3 — canonical identity, "company rename"
  // scenario): a legal-suffix/punctuation variant of the exact same real
  // company name must match — this is the concrete gap the audit found
  // ("Acme Inc" vs "Acme, Inc." previously never matched).
  it("matches a legal-suffix/punctuation variant of the same name (normalizeCompanyName)", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Widgets Pvt Ltd",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    expect(first.wasCreated).toBe(true);

    const second = await findOrCreateCompany({
      organizationId,
      name: "Widgets, Pvt. Ltd.",
      source: "AUTO_DISCOVERY",
      status: "LEAD",
    });

    expect(second.wasCreated).toBe(false);
    expect(second.company.id).toBe(first.company.id);
  });

  // Genuinely different companies must still never collapse into one just
  // because they share a common legal-suffix token.
  it("does NOT match two genuinely different companies that only share a legal-suffix token", async () => {
    const first = await findOrCreateCompany({
      organizationId,
      name: "Northwind Traders LLC",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    const second = await findOrCreateCompany({
      organizationId,
      name: "Contoso Systems LLC",
      source: "LEAD_FINDER",
      status: "LEAD",
    });

    expect(second.wasCreated).toBe(true);
    expect(second.company.id).not.toBe(first.company.id);
  });

  // Phase 24 (requirement #18, retry safety) — the single most important
  // new test: two near-simultaneous calls for the exact same real company
  // (same domain) must never both succeed in creating a Company row. The
  // real @@unique([organizationId, domain]) constraint plus the P2002
  // catch-and-reread fallback in findOrCreateCompany is what's under test
  // here, not just application-level "check then create" logic (which was
  // the actual bug — a plain await-in-sequence test would never have
  // caught it).
  it("never creates two Company rows for concurrent findOrCreateCompany calls with the same domain", async () => {
    const input = {
      organizationId,
      name: "Race Condition Co",
      website: "https://race-condition.example.com",
      source: "LEAD_FINDER" as const,
      status: "LEAD" as const,
    };

    const [a, b] = await Promise.all([findOrCreateCompany(input), findOrCreateCompany(input)]);

    expect(a.company.id).toBe(b.company.id);
    // Exactly one of the two calls actually created the row.
    expect([a.wasCreated, b.wasCreated].filter(Boolean)).toHaveLength(1);

    const rows = await prisma.company.findMany({
      where: { organizationId, domain: "race-condition.example.com" },
    });
    expect(rows).toHaveLength(1);
  });

  it("excludes a merged-away Company from matching — new discovery resolves to the surviving keeper", async () => {
    const keep = await findOrCreateCompany({
      organizationId,
      name: "Keeper Co",
      website: "https://keeper-co.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    const mergedAway = await findOrCreateCompany({
      organizationId,
      name: "Old Duplicate Co",
      website: "https://old-duplicate.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });
    await prisma.company.update({
      where: { id: mergedAway.company.id },
      data: { mergedIntoId: keep.company.id, mergedAt: new Date(), domain: null },
    });
    // Re-set the merged-away row's original domain AFTER clearing above is
    // unrealistic — instead simulate the real case: a fresh discovery of a
    // company whose name matches the merged-away row's old name.
    const rediscovered = await findOrCreateCompany({
      organizationId,
      name: "old duplicate co",
      source: "AUTO_DISCOVERY",
      status: "LEAD",
    });

    expect(rediscovered.wasCreated).toBe(true);
    expect(rediscovered.company.id).not.toBe(mergedAway.company.id);
  });
});
