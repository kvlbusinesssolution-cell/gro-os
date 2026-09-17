import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { syncCompanyTechnologiesFromScan } from "./technology-evidence-sync";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization/User/Company/WebsiteScan/Technology set, all deleted in
// afterAll. Organization delete cascades Company, WebsiteScan, Technology
// and CompanyEvidence; the User row (not FK-owned by Organization) is
// deleted separately.
describe("syncCompanyTechnologiesFromScan", () => {
  let organizationId: string;
  let userId: string;
  let companyId: string;
  let websiteScanId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Tech Evidence Sync Test Org", slug: `tech-evidence-sync-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const user = await prisma.user.create({ data: { email: `tech-evidence-sync-test-${Date.now()}@example.com` } });
    userId = user.id;

    const company = await prisma.company.create({
      data: { organizationId, name: "Signature Scan Co", website: "https://signature-scan.example.com", technologies: ["Stale Old Tech"] },
    });
    companyId = company.id;

    const scan = await prisma.websiteScan.create({
      data: {
        organizationId,
        companyId,
        createdByUserId: userId,
        url: "https://signature-scan.example.com",
        finalUrl: "https://signature-scan.example.com/",
        status: "COMPLETED",
        scannedAt: new Date(),
      },
    });
    websiteScanId = scan.id;

    await prisma.technology.createMany({
      data: [
        // Direct, structurally-validated matches (parsed <script src>) — expect 0.95 confidence.
        { scanId: websiteScanId, name: "Razorpay", category: "PAYMENT", evidence: 'Script source containing "checkout.razorpay.com": https://checkout.razorpay.com/v1/checkout.js' },
        { scanId: websiteScanId, name: "Calendly", category: "BOOKING", evidence: "Script source containing \"assets.calendly.com\": https://assets.calendly.com/assets/external/widget.js" },
        // Raw-HTML substring matches — expect 0.75 confidence (weaker/indirect signal).
        { scanId: websiteScanId, name: "WhatsApp Click-to-Chat", category: "MESSAGING", evidence: 'HTML contains "WhatsApp click-to-chat link"' },
        { scanId: websiteScanId, name: "Zoho CRM", category: "CRM_INDICATOR", evidence: 'HTML contains "Zoho CRM Web-to-Lead form action"' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });

    const leakedCompany = await prisma.company.count({ where: { id: companyId } });
    expect(leakedCompany).toBe(0);
    const leakedScan = await prisma.websiteScan.count({ where: { id: websiteScanId } });
    expect(leakedScan).toBe(0);
    const leakedEvidence = await prisma.companyEvidence.count({ where: { companyId } });
    expect(leakedEvidence).toBe(0);
    const leakedUser = await prisma.user.count({ where: { id: userId } });
    expect(leakedUser).toBe(0);
  });

  it("returns zeros and leaves Company.technologies untouched for a scan that doesn't exist", async () => {
    const result = await syncCompanyTechnologiesFromScan(companyId, "nonexistent-scan-id");
    expect(result).toEqual({ detected: 0, evidenceCreated: 0 });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.technologies).toEqual(["Stale Old Tech"]);
  });

  it("resyncs Company.technologies to the current scan's detections and writes evidence with tiered confidence", async () => {
    const result = await syncCompanyTechnologiesFromScan(companyId, websiteScanId);
    expect(result.detected).toBe(4);
    expect(result.evidenceCreated).toBe(4);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(new Set(company.technologies)).toEqual(new Set(["Razorpay", "Calendly", "WhatsApp Click-to-Chat", "Zoho CRM"]));
    // The stale one-time write is fully replaced by real current scan data.
    expect(company.technologies).not.toContain("Stale Old Tech");

    const evidenceRows = await prisma.companyEvidence.findMany({ where: { companyId, kind: "RAW_FACT" } });
    expect(evidenceRows.length).toBe(4);
    for (const row of evidenceRows) {
      expect(row.source).toBe("WEBSITE_SCAN");
      expect(row.sourceUrl).toBe("https://signature-scan.example.com/");
    }

    const razorpayEvidence = evidenceRows.find((r) => r.fact.includes("Razorpay"));
    expect(razorpayEvidence?.confidence).toBe(0.95);
    expect(razorpayEvidence?.fact).toContain("for payments");

    const calendlyEvidence = evidenceRows.find((r) => r.fact.includes("Calendly"));
    expect(calendlyEvidence?.confidence).toBe(0.95);

    const whatsappEvidence = evidenceRows.find((r) => r.fact.includes("WhatsApp"));
    expect(whatsappEvidence?.confidence).toBe(0.75);
    expect(whatsappEvidence?.fact).toContain("for customer messaging");

    const zohoEvidence = evidenceRows.find((r) => r.fact.includes("Zoho"));
    expect(zohoEvidence?.confidence).toBe(0.75);
    expect(zohoEvidence?.fact).toContain("as a CRM signal");
  });

  it("is idempotent — calling it again does not duplicate CompanyEvidence rows", async () => {
    const before = await prisma.companyEvidence.count({ where: { companyId } });

    const second = await syncCompanyTechnologiesFromScan(companyId, websiteScanId);
    expect(second.detected).toBe(4);
    expect(second.evidenceCreated).toBe(0);

    const after = await prisma.companyEvidence.count({ where: { companyId } });
    expect(after).toBe(before);
  });
});
