import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFieldWithWaterfallMock } = vi.hoisted(() => ({ fetchFieldWithWaterfallMock: vi.fn() }));
vi.mock("@/lib/ai/field-waterfall", () => ({ fetchFieldWithWaterfall: fetchFieldWithWaterfallMock }));

import { prisma } from "@/lib/prisma";
import { findOrCreateCompany } from "./dedup";
import { classifyBusinessType } from "./business-type-classification";

/**
 * Real Postgres integration test — the AI waterfall call itself is mocked
 * (already unit-tested in field-waterfall.test.ts), everything downstream
 * (evidence write, conflict resolution, Company.businessType write) is real.
 */
describe("classifyBusinessType — real evidence + conflict-resolution wiring (Phase 27)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "BizType Test Org", slug: `biztype-test-${Date.now()}` } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  beforeEach(() => {
    fetchFieldWithWaterfallMock.mockReset();
  });

  it("applies a real classification to a company with no prior evidence", async () => {
    const { company } = await findOrCreateCompany({
      organizationId,
      name: "SaaS Startup Co",
      website: "https://saas-startup.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });

    fetchFieldWithWaterfallMock.mockResolvedValueOnce({
      value: { businessType: "SAAS", reasoning: "Subscription software product." },
      finalSource: "STRUCTURED_EXTRACTION",
      usedRealWebSearch: false,
      totalInputTokens: 10,
      totalOutputTokens: 5,
    });

    const result = await classifyBusinessType(company.id);
    expect(result.businessType).toBe("SAAS");
    expect(result.applied).toBe(true);

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.businessType).toBe("SAAS");

    const evidence = await prisma.companyEvidence.findMany({ where: { companyId: company.id, fieldName: "businessType" } });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].source).toBe("COMPANY_INTELLIGENCE");
    expect(evidence[0].kind).toBe("AI_INTERPRETATION");
  });

  it("real conflict resolution: a lower-priority automated classification does NOT overwrite an existing MANUAL value — but is still recorded as evidence", async () => {
    const { company } = await findOrCreateCompany({
      organizationId,
      name: "Manually Classified Co",
      website: "https://manually-classified.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });

    // Simulate a real prior MANUAL correction already on file.
    await prisma.company.update({ where: { id: company.id }, data: { businessType: "B2B" } });
    await prisma.companyEvidence.create({
      data: { companyId: company.id, kind: "RAW_FACT", fact: "Manually classified as B2B.", source: "MANUAL", fieldName: "businessType", confidence: 1.0 },
    });

    fetchFieldWithWaterfallMock.mockResolvedValueOnce({
      value: { businessType: "MARKETPLACE", reasoning: "Looks like a marketplace." },
      finalSource: "STRUCTURED_EXTRACTION", // COMPANY_INTELLIGENCE priority — lower than MANUAL
      usedRealWebSearch: false,
      totalInputTokens: 10,
      totalOutputTokens: 5,
    });

    const result = await classifyBusinessType(company.id);
    expect(result.applied).toBe(false); // real conflict-resolution refusal

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.businessType).toBe("B2B"); // untouched — the manual value wins

    const evidence = await prisma.companyEvidence.findMany({ where: { companyId: company.id, fieldName: "businessType" } });
    expect(evidence).toHaveLength(2); // both the original MANUAL fact and the new (non-applied) observation are preserved
  });

  it("never applies or records an UNKNOWN classification — honest, not a fabricated guess", async () => {
    const { company } = await findOrCreateCompany({
      organizationId,
      name: "Ambiguous Co",
      website: "https://ambiguous.example.com",
      source: "LEAD_FINDER",
      status: "LEAD",
    });

    fetchFieldWithWaterfallMock.mockResolvedValueOnce({
      value: { businessType: "UNKNOWN", reasoning: "Not enough information." },
      finalSource: "WEB_SEARCH_RESEARCH",
      usedRealWebSearch: true,
      totalInputTokens: 10,
      totalOutputTokens: 5,
    });

    const result = await classifyBusinessType(company.id);
    expect(result.applied).toBe(false);
    expect(result.businessType).toBe("UNKNOWN");

    const evidence = await prisma.companyEvidence.findMany({ where: { companyId: company.id, fieldName: "businessType" } });
    expect(evidence).toHaveLength(0); // no real evidence recorded for a non-classification
  });
});
