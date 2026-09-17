import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { buildWebsiteIntelligenceEvidence } from "./website-intelligence";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization/User/Company/WebsiteScan, all deleted in afterAll.
describe("buildWebsiteIntelligenceEvidence", () => {
  let organizationId: string;
  let userId: string;
  let companyId: string;
  let websiteScanId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Website Intelligence Test Org", slug: `website-intel-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const user = await prisma.user.create({ data: { email: `website-intel-test-${Date.now()}@example.com` } });
    userId = user.id;

    const company = await prisma.company.create({
      data: { organizationId, name: "Poor Performance Co", website: "https://poor-performance.example.com" },
    });
    companyId = company.id;

    const otherCompany = await prisma.company.create({
      data: { organizationId, name: "Unrelated Co" },
    });
    otherCompanyId = otherCompany.id;

    const scan = await prisma.websiteScan.create({
      data: {
        organizationId,
        companyId,
        createdByUserId: userId,
        url: "https://poor-performance.example.com",
        finalUrl: "https://poor-performance.example.com/",
        status: "COMPLETED",
        scannedAt: new Date(),
      },
    });
    websiteScanId = scan.id;

    // Deliberately poor scores + a real fail-status finding so an
    // interpretation is plausible.
    await prisma.performanceAudit.create({
      data: {
        scanId: websiteScanId,
        responseTimeMs: 4800,
        htmlSizeBytes: 900_000,
        scriptTagCount: 42,
        stylesheetCount: 12,
        imageTagCount: 30,
        hasCaching: false,
        hasCompression: false,
        renderBlockingScriptCount: 9,
        modernImageFormatPct: 0,
        lazyLoadedImagePct: 0,
        performanceScore: 18,
        findings: [
          { label: "Server response time", status: "fail", detail: "4800ms is far above the recommended 600ms threshold" },
          { label: "Compression", status: "fail", detail: "No gzip/brotli compression enabled" },
        ],
      },
    });

    await prisma.securityAudit.create({
      data: {
        scanId: websiteScanId,
        isHttps: false,
        hasHsts: false,
        hasCsp: false,
        hasXFrameOptions: false,
        hasXContentTypeOptions: false,
        mixedContentCount: 5,
        exposedSensitiveFileCount: 2,
        securityScore: 12,
        findings: [{ label: "HTTPS", status: "fail", detail: "Site is served over plain HTTP, no TLS certificate found" }],
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    const leaked = await prisma.companyEvidence.count({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    expect(leaked).toBe(0);
    const leakedScan = await prisma.websiteScan.count({ where: { id: websiteScanId } });
    expect(leakedScan).toBe(0);
  });

  it("returns zeros for a WebsiteScan that does not belong to the given company", async () => {
    const result = await buildWebsiteIntelligenceEvidence(otherCompanyId, websiteScanId);
    expect(result).toEqual({ factsCreated: 0, interpretationsCreated: 0 });

    const rows = await prisma.companyEvidence.findMany({ where: { companyId: otherCompanyId } });
    expect(rows).toHaveLength(0);
  });

  it("writes RAW_FACT evidence rows off the real audit data, and optionally an AI interpretation pass", async () => {
    // Real AI provider round-trip — needs a longer timeout than vitest's 5s default.
    const result = await buildWebsiteIntelligenceEvidence(companyId, websiteScanId);

    expect(result.factsCreated).toBeGreaterThan(0);

    const facts = await prisma.companyEvidence.findMany({ where: { companyId, kind: "RAW_FACT" } });
    expect(facts.length).toBe(result.factsCreated);
    for (const fact of facts) {
      expect(fact.source).toBe("WEBSITE_SCAN");
      expect(fact.confidence).toBe(1.0);
      expect(fact.sourceUrl).toBe("https://poor-performance.example.com/");
    }
    // Sanity: real field values actually made it into the fact text.
    expect(facts.some((f) => f.fact.includes("Performance score: 18/100"))).toBe(true);
    expect(facts.some((f) => f.fact.includes("Security score: 12/100"))).toBe(true);

    if (!isAIConnected()) {
      console.warn("[website-intelligence.test] No AI provider configured in this environment — skipping interpretation assertions.");
      expect(result.interpretationsCreated).toBe(0);
      return;
    }

    const interpretations = await prisma.companyEvidence.findMany({ where: { companyId, kind: "AI_INTERPRETATION" } });
    expect(interpretations.length).toBe(result.interpretationsCreated);
    if (interpretations.length === 0) {
      console.warn("[website-intelligence.test] AI call returned zero interpretations — soft-asserting rather than failing.");
    }
    for (const interpretation of interpretations) {
      expect(interpretation.source).toBe("COMPANY_INTELLIGENCE");
      expect(interpretation.confidence).toBeGreaterThanOrEqual(0);
      expect(interpretation.confidence).toBeLessThanOrEqual(1);
      expect(interpretation.fact.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("is idempotent — calling it again does not duplicate the RAW_FACT rows", async () => {
    const before = await prisma.companyEvidence.count({ where: { companyId, kind: "RAW_FACT" } });

    const second = await buildWebsiteIntelligenceEvidence(companyId, websiteScanId);
    expect(second.factsCreated).toBe(0);

    const after = await prisma.companyEvidence.count({ where: { companyId, kind: "RAW_FACT" } });
    expect(after).toBe(before);
  });
});
