import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { discoverPotentialPartners } from "./partner-discovery";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization, deleted in afterAll (cascades to any ReferralPartner rows
// created during the test).
//
// Uses a real, plausible business profile (web development agency) as the
// discovery context — a fabricated/nonsense profile would give a real web
// search nothing genuine to find, defeating the point of this being a real
// integration test of the web-search-grounded path.
describe("discoverPotentialPartners", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: {
        name: "Partner Discovery Test Org",
        slug: `partner-discovery-test-org-${Date.now()}`,
        industry: "Web & Software Development Agency",
        primaryMarket: "India",
        countriesServed: ["India"],
        clientTypes: ["SMBs", "Startups"],
        services: ["Website Development", "CRM", "SaaS Development"],
      },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.referralPartner.count({ where: { organizationId } });
    expect(leaked).toBe(0);
  });

  it("returns zeros gracefully for a nonexistent organizationId, never throws", async () => {
    const result = await discoverPotentialPartners("nonexistent-organization-id-does-not-exist");
    expect(result).toEqual({ found: 0, created: 0 });
  });

  it("discovers real, evidence-backed potential partners (or gracefully returns zero if AI is unavailable)", async () => {
    if (!isAIConnected()) {
      const result = await discoverPotentialPartners(organizationId);
      expect(result).toEqual({ found: 0, created: 0 });
      console.warn("[partner-discovery.test] No AI provider configured in this environment — skipping live-search assertions.");
      return;
    }

    const result = await discoverPotentialPartners(organizationId);
    expect(result.created).toBeLessThanOrEqual(result.found);

    const rows = await prisma.referralPartner.findMany({ where: { organizationId } });
    expect(rows.length).toBe(result.created);

    if (rows.length === 0) {
      console.warn("[partner-discovery.test] AI call returned zero verifiable candidates — soft-asserting rather than failing.");
      return;
    }

    for (const row of rows) {
      expect(row.name.trim().length).toBeGreaterThan(0);
      // Every AI-discovered row must be a CANDIDATE, never auto-promoted to
      // ACTIVE — recruiting is always a separate, human, manual step.
      expect(row.status).toBe("CANDIDATE");
      expect([
        "FREELANCER",
        "DIGITAL_AGENCY",
        "SEO_AGENCY",
        "MARKETING_CONSULTANT",
        "IT_CONSULTANT",
        "BUSINESS_CONSULTANT",
        "DESIGNER",
        "TECHNOLOGY_CONSULTANT",
      ]).toContain(row.type);
      expect(row.discoverySource?.trim().length ?? 0).toBeGreaterThan(0);
      expect(row.notes?.trim().length ?? 0).toBeGreaterThan(0);
    }
  }, 60_000);

  it("is idempotent by name/website — re-running never duplicates a candidate it already knows about", async () => {
    if (!isAIConnected()) return;

    const before = await prisma.referralPartner.findMany({ where: { organizationId } });
    if (before.length === 0) {
      console.warn("[partner-discovery.test] No prior rows to dedup against — skipping idempotency assertions.");
      return;
    }
    const beforeCount = before.length;
    const beforeIds = new Set(before.map((r) => r.id));

    const second = await discoverPotentialPartners(organizationId);

    const after = await prisma.referralPartner.findMany({ where: { organizationId } });

    const namesSeen = new Set<string>();
    for (const row of after) {
      const key = row.name.trim().toLowerCase();
      expect(namesSeen.has(key)).toBe(false);
      namesSeen.add(key);
    }

    // Row-accounting invariant: the table only ever grows by exactly the
    // number of genuinely new (non-matching) candidates this run created.
    expect(after.length).toBe(beforeCount + second.created);

    // Every row present before the second run is still present after it —
    // an already-known candidate is never deleted/replaced by a re-run.
    for (const id of beforeIds) {
      expect(after.some((row) => row.id === id)).toBe(true);
    }
  }, 60_000);
});
