import { describe, expect, it, vi, beforeEach } from "vitest";

const companyFindUniqueOrThrow = vi.fn();
const websiteScanFindFirst = vi.fn();
const companyEvidenceFindMany = vi.fn();
const companyEvidenceCreateMany = vi.fn();
const companyUpdate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUniqueOrThrow: (...args: unknown[]) => companyFindUniqueOrThrow(...args), update: (...args: unknown[]) => companyUpdate(...args) },
    websiteScan: { findFirst: (...args: unknown[]) => websiteScanFindFirst(...args) },
    companyEvidence: {
      findMany: (...args: unknown[]) => companyEvidenceFindMany(...args),
      createMany: (...args: unknown[]) => companyEvidenceCreateMany(...args),
    },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isWappalyzerConfigured = vi.fn();
const wappalyzerLookup = vi.fn();
vi.mock("./providers/wappalyzer", () => ({
  isWappalyzerConfigured: (...args: unknown[]) => isWappalyzerConfigured(...args),
  wappalyzerLookup: (...args: unknown[]) => wappalyzerLookup(...args),
}));

const resolveFieldConflict = vi.fn();
vi.mock("@/lib/business-development/evidence-priority", () => ({
  resolveFieldConflict: (...args: unknown[]) => resolveFieldConflict(...args),
}));

const { enrichCompanyTechnologyIfNoScan } = await import("./technology-signal");

const COMPANY = { id: "company-1", organizationId: "org-1", domain: "acme.com" };

describe("technology-signal.ts — enrichCompanyTechnologyIfNoScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyFindUniqueOrThrow.mockResolvedValue(COMPANY);
    companyEvidenceFindMany.mockResolvedValue([]);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: true });
  });

  it("does not attempt a lookup when Wappalyzer is not configured", async () => {
    isWappalyzerConfigured.mockReturnValue(false);

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result).toEqual({ attempted: false, detected: 0, evidenceCreated: 0 });
    expect(wappalyzerLookup).not.toHaveBeenCalled();
  });

  it("does not attempt a lookup when the company has no domain", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, domain: null });

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result.attempted).toBe(false);
    expect(wappalyzerLookup).not.toHaveBeenCalled();
  });

  it("skips the lookup entirely when a completed WebsiteScan already exists — never duplicates the in-house scanner", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    websiteScanFindFirst.mockResolvedValue({ id: "scan-1" });

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result.attempted).toBe(false);
    expect(wappalyzerLookup).not.toHaveBeenCalled();
  });

  it("writes real CompanyEvidence facts and updates Company.technologies when no scan exists", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    websiteScanFindFirst.mockResolvedValue(null);
    wappalyzerLookup.mockResolvedValue({
      ok: true,
      technologies: [
        { name: "React", categories: ["JavaScript frameworks"] },
        { name: "Stripe", categories: ["Payment processors"] },
      ],
    });

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result).toEqual({ attempted: true, detected: 2, evidenceCreated: 2 });
    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { technologies: ["React", "Stripe"] } });
    expect(companyEvidenceCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ companyId: "company-1", source: "WAPPALYZER", fieldName: "technologies" })]),
    });
  });

  it("never overwrites Company.technologies when a higher-priority source already backs the field", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    websiteScanFindFirst.mockResolvedValue(null);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: false });
    wappalyzerLookup.mockResolvedValue({ ok: true, technologies: [{ name: "React", categories: [] }] });

    await enrichCompanyTechnologyIfNoScan("company-1");

    expect(companyUpdate).not.toHaveBeenCalled();
    expect(companyEvidenceCreateMany).toHaveBeenCalled(); // evidence is still recorded either way
  });

  it("skips writing a duplicate fact that was already recorded", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    websiteScanFindFirst.mockResolvedValue(null);
    wappalyzerLookup.mockResolvedValue({ ok: true, technologies: [{ name: "React", categories: [] }] });
    companyEvidenceFindMany.mockImplementation(({ where }: { where: { fieldName?: string; source?: string } }) =>
      where.source === "WAPPALYZER" ? [{ fact: "Uses React — detected via Wappalyzer." }] : [],
    );

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result.evidenceCreated).toBe(0);
    expect(companyEvidenceCreateMany).not.toHaveBeenCalled();
  });

  it("returns attempted: true with zero results (never fabricates) when the lookup fails", async () => {
    isWappalyzerConfigured.mockReturnValue(true);
    websiteScanFindFirst.mockResolvedValue(null);
    wappalyzerLookup.mockResolvedValue({ ok: false, error: "timeout" });

    const result = await enrichCompanyTechnologyIfNoScan("company-1");

    expect(result).toEqual({ attempted: true, detected: 0, evidenceCreated: 0 });
    expect(companyUpdate).not.toHaveBeenCalled();
  });
});
