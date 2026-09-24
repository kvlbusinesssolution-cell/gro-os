import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

const resolveFieldConflict = vi.fn();
vi.mock("@/lib/business-development/evidence-priority", () => ({
  resolveFieldConflict: (...args: unknown[]) => resolveFieldConflict(...args),
}));

const { enrichCompanyPhoneFromWebsite } = await import("./company-phone-finder");

const COMPANY = { id: "company-1", organizationId: "org-1", website: "https://acme.com", phone: null as string | null };

describe("company-phone-finder.ts — enrichCompanyPhoneFromWebsite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    companyFindUniqueOrThrow.mockResolvedValue(COMPANY);
    companyEvidenceFindMany.mockResolvedValue([]);
    companyEvidenceFindFirst.mockResolvedValue(null);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when Company.phone is already set — fill-when-empty", async () => {
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, phone: "+1 555 0100" });

    const result = await enrichCompanyPhoneFromWebsite("company-1");

    expect(result).toEqual({ attempted: false, found: false });
  });

  it("does nothing when the company has no website", async () => {
    companyFindUniqueOrThrow.mockResolvedValue({ ...COMPANY, website: null });

    const result = await enrichCompanyPhoneFromWebsite("company-1");

    expect(result).toEqual({ attempted: false, found: false });
  });

  it("extracts a phone number from a real tel: link and writes CompanyEvidence + Company.phone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `<a href="tel:+15550100">Call us</a>` }));

    const result = await enrichCompanyPhoneFromWebsite("company-1");

    expect(result).toEqual({ attempted: true, found: true });
    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { phone: "+15550100" } });
    expect(companyEvidenceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: "company-1", source: "COMPANY_WEBSITE", fieldName: "phone" }) }));
  });

  it("never overwrites Company.phone when a higher-priority source already backs the field", async () => {
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `<a href="tel:+15550100">Call us</a>` }));

    await enrichCompanyPhoneFromWebsite("company-1");

    expect(companyUpdate).not.toHaveBeenCalled();
    expect(companyEvidenceCreate).toHaveBeenCalled();
  });

  it("returns attempted: true, found: false (never fabricates) when no phone number is on the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `<html><body>No contact info here</body></html>` }));

    const result = await enrichCompanyPhoneFromWebsite("company-1");

    expect(result).toEqual({ attempted: true, found: false });
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it("returns attempted: true, found: false when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await enrichCompanyPhoneFromWebsite("company-1");

    expect(result).toEqual({ attempted: true, found: false });
  });

  it("does not write a duplicate CompanyEvidence row for a fact already on file", async () => {
    companyEvidenceFindFirst.mockResolvedValue({ id: "evidence-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `<a href="tel:+15550100">Call us</a>` }));

    await enrichCompanyPhoneFromWebsite("company-1");

    expect(companyEvidenceCreate).not.toHaveBeenCalled();
  });
});
