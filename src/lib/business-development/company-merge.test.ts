import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { mergeCompanies } from "./company-merge";

// Real local-Postgres integration test, matching dedup.test.ts's convention.
describe("mergeCompanies — Phase 24 requirement #4 (company merge safety)", () => {
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Merge Test Org A", slug: `merge-test-org-a-${suffix}` } });
    const orgB = await prisma.organization.create({ data: { name: "Merge Test Org B", slug: `merge-test-org-b-${suffix}` } });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("reassigns real child records (Contact, CompanyEvidence) from the merge-away company to the keeper, inside one transaction", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Keeper Inc", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgAId, name: "Duplicate Inc", source: "MANUAL", status: "PROSPECT" } });

    const contact = await prisma.contact.create({
      data: { organizationId: orgAId, companyId: away.id, firstName: "Jane", email: `jane-${Date.now()}@example.com` },
    });
    const evidence = await prisma.companyEvidence.create({
      data: { companyId: away.id, kind: "RAW_FACT", fact: "Test fact", source: "MANUAL", confidence: 1.0 },
    });

    const result = await mergeCompanies(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(true);
    expect(result.reassignedCounts?.contact).toBe(1);
    expect(result.reassignedCounts?.companyEvidence).toBe(1);

    const movedContact = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    const movedEvidence = await prisma.companyEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
    expect(movedContact.companyId).toBe(keep.id);
    expect(movedEvidence.companyId).toBe(keep.id);
  });

  it("soft-merges — the away company is never deleted, is flagged mergedIntoId, and stays reachable via mergedInto", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Keeper Two", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgAId, name: "Duplicate Two", source: "MANUAL", status: "PROSPECT" } });

    await mergeCompanies(orgAId, keep.id, away.id, null);

    const awayRow = await prisma.company.findUnique({ where: { id: away.id }, include: { mergedInto: true } });
    expect(awayRow).not.toBeNull();
    expect(awayRow?.mergedIntoId).toBe(keep.id);
    expect(awayRow?.mergedAt).toBeInstanceOf(Date);
    expect(awayRow?.mergedInto?.id).toBe(keep.id);
  });

  it("drops the merge-away company's IntentScore (1:1 @unique) rather than violating the constraint, when the keeper already has one", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Keeper Three", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgAId, name: "Duplicate Three", source: "MANUAL", status: "PROSPECT" } });

    await prisma.intentScore.create({
      data: { companyId: keep.id, score: 80, band: "HIGH", signals: [], reasoning: "keeper reasoning" },
    });
    const awayScore = await prisma.intentScore.create({
      data: { companyId: away.id, score: 20, band: "LOW", signals: [], reasoning: "away reasoning" },
    });

    const result = await mergeCompanies(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(true);
    expect(result.reassignedCounts?.intentScore_dropped_duplicate).toBe(1);

    const stillExists = await prisma.intentScore.findUnique({ where: { id: awayScore.id } });
    expect(stillExists).toBeNull();
    const keeperScore = await prisma.intentScore.findUniqueOrThrow({ where: { companyId: keep.id } });
    expect(keeperScore.score).toBe(80); // keeper's own real score untouched
  });

  it("reassigns IntentScore normally when the keeper does not already have one", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Keeper Four", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgAId, name: "Duplicate Four", source: "MANUAL", status: "PROSPECT" } });

    const awayScore = await prisma.intentScore.create({
      data: { companyId: away.id, score: 55, band: "MEDIUM", signals: [], reasoning: "away reasoning" },
    });

    const result = await mergeCompanies(orgAId, keep.id, away.id, null);
    expect(result.reassignedCounts?.intentScore).toBe(1);

    const moved = await prisma.intentScore.findUnique({ where: { id: awayScore.id } });
    expect(moved?.companyId).toBe(keep.id);
  });

  it("rejects merging companies that belong to different organizations", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Org A Company", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgBId, name: "Org B Company", source: "MANUAL", status: "PROSPECT" } });

    const result = await mergeCompanies(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found in your organization/);

    // Real proof nothing changed.
    const unchanged = await prisma.company.findUniqueOrThrow({ where: { id: away.id } });
    expect(unchanged.mergedIntoId).toBeNull();
    expect(unchanged.organizationId).toBe(orgBId);
  });

  it("rejects merging a company into itself", async () => {
    const company = await prisma.company.create({ data: { organizationId: orgAId, name: "Self Co", source: "MANUAL", status: "PROSPECT" } });
    const result = await mergeCompanies(orgAId, company.id, company.id, null);
    expect(result.ok).toBe(false);
  });

  it("rejects merging a company that has already been merged away", async () => {
    const keep = await prisma.company.create({ data: { organizationId: orgAId, name: "Keeper Five", source: "MANUAL", status: "PROSPECT" } });
    const away = await prisma.company.create({ data: { organizationId: orgAId, name: "Duplicate Five", source: "MANUAL", status: "PROSPECT" } });
    const other = await prisma.company.create({ data: { organizationId: orgAId, name: "Third Co", source: "MANUAL", status: "PROSPECT" } });

    const first = await mergeCompanies(orgAId, keep.id, away.id, null);
    expect(first.ok).toBe(true);

    const second = await mergeCompanies(orgAId, other.id, away.id, null);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been merged/);
  });
});
