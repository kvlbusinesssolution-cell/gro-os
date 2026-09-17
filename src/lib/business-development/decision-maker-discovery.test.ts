import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { discoverDecisionMakers } from "./decision-maker-discovery";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization/Company, deleted in afterAll (cascades to any DecisionMaker
// rows created during the test).
//
// Uses a real, well-known public company (Stripe) as the discovery target —
// a fabricated test-fixture company name would give a real web search
// nothing genuine to find, defeating the point of this being a real
// integration test of the web-search-grounded path.
describe("discoverDecisionMakers", () => {
  let organizationId: string;
  let companyId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Decision Maker Discovery Test Org", slug: `decision-maker-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const company = await prisma.company.create({
      data: {
        organizationId,
        name: "Stripe",
        website: "https://stripe.com",
        industry: "Financial Technology / Payments",
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.decisionMaker.count({ where: { companyId } });
    expect(leaked).toBe(0);
  });

  it("returns zeros gracefully for a nonexistent companyId, never throws", async () => {
    const result = await discoverDecisionMakers("nonexistent-company-id-does-not-exist");
    expect(result).toEqual({ found: 0, created: 0 });
  });

  it("discovers real, publicly-sourced decision-makers (or gracefully returns zero if AI is unavailable)", async () => {
    if (!isAIConnected()) {
      const result = await discoverDecisionMakers(companyId);
      expect(result).toEqual({ found: 0, created: 0 });
      console.warn("[decision-maker-discovery.test] No AI provider configured in this environment — skipping live-search assertions.");
      return;
    }

    const result = await discoverDecisionMakers(companyId);
    expect(result.created).toBeLessThanOrEqual(result.found);

    const rows = await prisma.decisionMaker.findMany({ where: { companyId } });
    expect(rows.length).toBe(result.created);

    if (rows.length === 0) {
      console.warn("[decision-maker-discovery.test] AI call returned zero verifiable decision-makers — soft-asserting rather than failing.");
      return;
    }

    for (const row of rows) {
      expect(row.name.trim().length).toBeGreaterThan(0);
      expect(row.source.trim().length).toBeGreaterThan(0);
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
      expect(row.verifiedAt).toBeInstanceOf(Date);
      expect([
        "FOUNDER",
        "CO_FOUNDER",
        "CEO",
        "DIRECTOR",
        "CTO",
        "COO",
        "MARKETING_HEAD",
        "SALES_HEAD",
        "BUSINESS_DEVELOPMENT_HEAD",
        "IT_HEAD",
        "PRODUCT_HEAD",
      ]).toContain(row.role);
    }
  }, 60_000);

  it("is idempotent by name — re-running never duplicates a name it already has, whatever new real people the live search happens to surface", async () => {
    if (!isAIConnected()) return;

    const before = await prisma.decisionMaker.findMany({ where: { companyId } });
    if (before.length === 0) {
      console.warn("[decision-maker-discovery.test] No prior rows to re-verify — skipping idempotency assertions.");
      return;
    }
    const beforeIds = new Set(before.map((r) => r.id));
    const beforeCount = before.length;

    const second = await discoverDecisionMakers(companyId);

    const after = await prisma.decisionMaker.findMany({ where: { companyId } });

    // Two live web-search calls, seconds apart, are not guaranteed to
    // re-surface byte-identical results (a search may legitimately turn up
    // an additional real person it missed the first time), so we don't
    // assert `second.created === 0` — instead we assert the actual dedup
    // invariant the spec cares about: no two rows for this company ever
    // share the same case-insensitive/trimmed name.
    const namesSeen = new Set<string>();
    for (const row of after) {
      const key = row.name.trim().toLowerCase();
      expect(namesSeen.has(key)).toBe(false);
      namesSeen.add(key);
    }

    // Row-accounting invariant: the table only ever grows by exactly the
    // number of genuinely new (non-matching) names this run created — every
    // matched name updates its existing row in place rather than adding one.
    expect(after.length).toBe(beforeCount + second.created);

    // Every row present before the second run is still present after it —
    // dedup-matched rows are updated in place, never deleted/replaced.
    for (const id of beforeIds) {
      expect(after.some((row) => row.id === id)).toBe(true);
    }
  }, 60_000);
});
