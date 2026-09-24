import { describe, expect, it, vi, beforeEach } from "vitest";

const companyFindUniqueOrThrow = vi.fn();
const companyEvidenceFindMany = vi.fn();
const companyEvidenceFindFirst = vi.fn();
const companyEvidenceCreate = vi.fn();
const companyUpdate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUniqueOrThrow: (...args: unknown[]) => companyFindUniqueOrThrow(...args), update: (...args: unknown[]) => companyUpdate(...args) },
    companyEvidence: {
      findMany: (...args: unknown[]) => companyEvidenceFindMany(...args),
      findFirst: (...args: unknown[]) => companyEvidenceFindFirst(...args),
      create: (...args: unknown[]) => companyEvidenceCreate(...args),
    },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isFmpConfigured = vi.fn();
const fmpSearchSymbol = vi.fn();
const fmpCompanyProfile = vi.fn();
vi.mock("./providers/fmp", () => ({
  isFmpConfigured: (...args: unknown[]) => isFmpConfigured(...args),
  fmpSearchSymbol: (...args: unknown[]) => fmpSearchSymbol(...args),
  fmpCompanyProfile: (...args: unknown[]) => fmpCompanyProfile(...args),
}));

const resolveFieldConflict = vi.fn();
vi.mock("@/lib/business-development/evidence-priority", () => ({
  resolveFieldConflict: (...args: unknown[]) => resolveFieldConflict(...args),
}));

const { enrichCompanySizeFromFmp } = await import("./company-size-finder");

const COMPANY = { id: "company-1", organizationId: "org-1", name: "Acme Corp", employeeCount: null as number | null };

describe("company-size-finder.ts — enrichCompanySizeFromFmp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyFindUniqueOrThrow.mockResolvedValue(COMPANY);
    companyEvidenceFindMany.mockResolvedValue([]);
    companyEvidenceFindFirst.mockResolvedValue(null);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: true });
  });

  it("does not attempt a lookup when FMP is not configured", async () => {
    isFmpConfigured.mockReturnValue(false);

    const result = await enrichCompanySizeFromFmp("company-1");

    expect(result).toEqual({ attempted: false, found: false });
    expect(fmpSearchSymbol).not.toHaveBeenCalled();
  });

  it("does nothing when Company.employeeCount is already set — fill-when-empty", async () => {
    isFmpConfigured.mockReturnValue(true);
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, employeeCount: 500 });

    const result = await enrichCompanySizeFromFmp("company-1");

    expect(result).toEqual({ attempted: false, found: false });
    expect(fmpSearchSymbol).not.toHaveBeenCalled();
  });

  it("writes real CompanyEvidence + Company.employeeCount when a symbol and profile are found", async () => {
    isFmpConfigured.mockReturnValue(true);
    fmpSearchSymbol.mockResolvedValue({ ok: true, symbol: "ACME" });
    fmpCompanyProfile.mockResolvedValue({ ok: true, fullTimeEmployees: 1250 });

    const result = await enrichCompanySizeFromFmp("company-1");

    expect(result).toEqual({ attempted: true, found: true });
    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { employeeCount: 1250 } });
    expect(companyEvidenceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: "company-1", source: "FMP", fieldName: "employeeCount" }) }));
  });

  it("returns attempted: true, found: false (never fabricates) when no symbol matches — a real coverage limit for private companies", async () => {
    isFmpConfigured.mockReturnValue(true);
    fmpSearchSymbol.mockResolvedValue({ ok: false, error: "No matching symbol found" });

    const result = await enrichCompanySizeFromFmp("company-1");

    expect(result).toEqual({ attempted: true, found: false });
    expect(fmpCompanyProfile).not.toHaveBeenCalled();
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it("returns attempted: true, found: false when the symbol is found but no employee count is reported", async () => {
    isFmpConfigured.mockReturnValue(true);
    fmpSearchSymbol.mockResolvedValue({ ok: true, symbol: "ACME" });
    fmpCompanyProfile.mockResolvedValue({ ok: false, error: "No employee count reported" });

    const result = await enrichCompanySizeFromFmp("company-1");

    expect(result).toEqual({ attempted: true, found: false });
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it("never overwrites Company.employeeCount when a higher-priority source already backs the field", async () => {
    isFmpConfigured.mockReturnValue(true);
    fmpSearchSymbol.mockResolvedValue({ ok: true, symbol: "ACME" });
    fmpCompanyProfile.mockResolvedValue({ ok: true, fullTimeEmployees: 1250 });
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: false });

    await enrichCompanySizeFromFmp("company-1");

    expect(companyUpdate).not.toHaveBeenCalled();
    expect(companyEvidenceCreate).toHaveBeenCalled();
  });
});
