import { describe, expect, it, vi, beforeEach } from "vitest";

const companyFindUniqueOrThrow = vi.fn();
const companyEvidenceFindMany = vi.fn();
const companyEvidenceCreateMany = vi.fn();
const companyUpdate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUniqueOrThrow: (...args: unknown[]) => companyFindUniqueOrThrow(...args), update: (...args: unknown[]) => companyUpdate(...args) },
    companyEvidence: {
      findMany: (...args: unknown[]) => companyEvidenceFindMany(...args),
      createMany: (...args: unknown[]) => companyEvidenceCreateMany(...args),
    },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isSecEdgarConfigured = vi.fn();
const edgarFindFormDFilings = vi.fn();
vi.mock("./providers/sec-edgar", () => ({
  isSecEdgarConfigured: (...args: unknown[]) => isSecEdgarConfigured(...args),
  edgarFindFormDFilings: (...args: unknown[]) => edgarFindFormDFilings(...args),
}));

const resolveFieldConflict = vi.fn();
vi.mock("@/lib/business-development/evidence-priority", () => ({
  resolveFieldConflict: (...args: unknown[]) => resolveFieldConflict(...args),
}));

const { enrichCompanyFundingFromEdgar } = await import("./company-funding-finder");

const COMPANY = { id: "company-1", organizationId: "org-1", name: "Acme Corp", fundingStage: null as string | null, fundingDate: null as Date | null };

describe("company-funding-finder.ts — enrichCompanyFundingFromEdgar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyFindUniqueOrThrow.mockResolvedValue(COMPANY);
    companyEvidenceFindMany.mockResolvedValue([]);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: true });
  });

  it("does not attempt a lookup when SEC EDGAR is not configured", async () => {
    isSecEdgarConfigured.mockReturnValue(false);

    const result = await enrichCompanyFundingFromEdgar("company-1");

    expect(result).toEqual({ attempted: false, filingsFound: 0, evidenceCreated: 0 });
    expect(edgarFindFormDFilings).not.toHaveBeenCalled();
  });

  it("writes real CompanyEvidence rows and sets fundingStage + fundingDate when a Form D filing is found", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    edgarFindFormDFilings.mockResolvedValue({
      ok: true,
      filings: [{ filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" }],
    });

    const result = await enrichCompanyFundingFromEdgar("company-1");

    expect(result).toEqual({ attempted: true, filingsFound: 1, evidenceCreated: 1 });
    expect(companyEvidenceCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ companyId: "company-1", source: "SEC_EDGAR", fieldName: "fundingStage" })]),
    });
    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: "company-1" },
      data: { fundingStage: "Private placement (SEC Form D)", fundingDate: new Date("2026-03-01") },
    });
  });

  it("picks the most recent filing date across multiple Form D filings", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    edgarFindFormDFilings.mockResolvedValue({
      ok: true,
      filings: [
        { filingDate: "2024-01-15", accessionNumber: "0001234567-24-000001", formType: "D", entityName: "ACME CORP" },
        { filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" },
      ],
    });

    await enrichCompanyFundingFromEdgar("company-1");

    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: "company-1" },
      data: { fundingStage: "Private placement (SEC Form D)", fundingDate: new Date("2026-03-01") },
    });
  });

  it("never overwrites an existing fundingStage or fundingDate value", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, fundingStage: "Series A", fundingDate: new Date("2025-01-01") });
    edgarFindFormDFilings.mockResolvedValue({
      ok: true,
      filings: [{ filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" }],
    });

    await enrichCompanyFundingFromEdgar("company-1");

    expect(companyUpdate).not.toHaveBeenCalled();
    expect(companyEvidenceCreateMany).toHaveBeenCalled();
  });

  it("fills fundingDate alone when fundingStage is already set but fundingDate is still empty", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, fundingStage: "Series A", fundingDate: null });
    edgarFindFormDFilings.mockResolvedValue({
      ok: true,
      filings: [{ filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" }],
    });

    await enrichCompanyFundingFromEdgar("company-1");

    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { fundingDate: new Date("2026-03-01") } });
  });

  it("returns attempted: true with zero results (never fabricates) when no Form D filings exist", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    edgarFindFormDFilings.mockResolvedValue({ ok: true, filings: [] });

    const result = await enrichCompanyFundingFromEdgar("company-1");

    expect(result).toEqual({ attempted: true, filingsFound: 0, evidenceCreated: 0 });
    expect(companyEvidenceCreateMany).not.toHaveBeenCalled();
  });

  it("skips writing a duplicate filing fact already recorded", async () => {
    isSecEdgarConfigured.mockReturnValue(true);
    edgarFindFormDFilings.mockResolvedValue({
      ok: true,
      filings: [{ filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" }],
    });
    companyEvidenceFindMany.mockResolvedValue([
      { fact: `Filed a Form D (private placement notice) with the SEC on 2026-03-01 under the name "ACME CORP" (accession 0001234567-26-000123). See https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=0001234567-26-000123` },
    ]);

    const result = await enrichCompanyFundingFromEdgar("company-1");

    expect(result.evidenceCreated).toBe(0);
    expect(companyEvidenceCreateMany).not.toHaveBeenCalled();
  });
});
