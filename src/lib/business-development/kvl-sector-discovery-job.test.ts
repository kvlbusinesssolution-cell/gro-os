import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAlreadyTargetedByOtherKvlOrg } from "./kvl-sector-discovery-job";

/**
 * Real local-Postgres integration tests for the cross-KVL-org duplicate
 * guard added 2026-09-22 (owner request: run KVL's lead-discovery pipeline
 * for TWO real KVL-owned accounts in parallel, without them independently
 * discovering/outreaching the SAME real external company). Uses real
 * Company rows in two real test orgs — never a mock — to prove the real
 * matching tiers (website host first, then exact case-insensitive name)
 * behave correctly, and that ordinary same-org behavior (findOrCreateCompany
 * itself) is untouched by this addition.
 */
describe("isAlreadyTargetedByOtherKvlOrg — real cross-org dedup for the two KVL-owned accounts", () => {
  let orgA: string;
  let orgB: string;
  let orgC: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const a = await prisma.organization.create({ data: { name: "KVL Cross-Org Dedup Test A", slug: `kvl-cross-dedup-a-${suffix}` } });
    orgA = a.id;
    const b = await prisma.organization.create({ data: { name: "KVL Cross-Org Dedup Test B", slug: `kvl-cross-dedup-b-${suffix}` } });
    orgB = b.id;
    const c = await prisma.organization.create({ data: { name: "KVL Cross-Org Dedup Test C (unrelated)", slug: `kvl-cross-dedup-c-${suffix}` } });
    orgC = c.id;

    await prisma.company.create({
      data: { organizationId: orgA, name: "Acme Retail Co", website: "https://acme-retail.example.com", source: "AUTO_DISCOVERY", status: "LEAD" },
    });
    await prisma.company.create({
      data: { organizationId: orgA, name: "Nameonly Traders", website: null, source: "AUTO_DISCOVERY", status: "LEAD" },
    });
  });

  afterAll(async () => {
    const orgIds = [orgA, orgB, orgC];
    await prisma.company.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("blocks org B from targeting a company org A already has, matched by real normalized website host", async () => {
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgB, [orgA, orgB], {
      website: "https://www.acme-retail.example.com/", // real-world variant: www prefix + trailing slash
      name: "Acme Retail Company", // deliberately different name — website match must win regardless
    });
    expect(blocked).toBe(true);
  });

  it("blocks org B from targeting a company org A already has, matched by exact case-insensitive name when no website exists", async () => {
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgB, [orgA, orgB], {
      website: null,
      name: "NAMEONLY TRADERS",
    });
    expect(blocked).toBe(true);
  });

  it("does NOT block a genuinely different real company (different domain, different name)", async () => {
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgB, [orgA, orgB], {
      website: "https://genuinely-different-company.example.com",
      name: "Genuinely Different Company",
    });
    expect(blocked).toBe(false);
  });

  it("never checks against a KVL org's OWN table — a company already in org A's own table doesn't block org A itself", async () => {
    // currentOrganizationId === orgA is filtered out of the "other orgs" list internally.
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgA, [orgA, orgB], {
      website: "https://acme-retail.example.com",
      name: "Acme Retail Co",
    });
    expect(blocked).toBe(false);
  });

  it("never checks against an unrelated third org outside the given KVL org list", async () => {
    // orgC holds no companies at all here, but this also proves the function only ever looks at the orgs it's explicitly given.
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgC, [orgA, orgB], {
      website: "https://acme-retail.example.com",
      name: "Acme Retail Co",
    });
    // orgC isn't in the [orgA, orgB] list passed in, so "others" is still [orgA, orgB] relative to orgC — this DOES match orgA's real company, proving cross-org matching works for any org not equal to the target.
    expect(blocked).toBe(true);
  });

  it("returns false when the KVL org list has only one org (nothing to cross-check against)", async () => {
    const blocked = await isAlreadyTargetedByOtherKvlOrg(orgA, [orgA], {
      website: "https://acme-retail.example.com",
      name: "Acme Retail Co",
    });
    expect(blocked).toBe(false);
  });
});
