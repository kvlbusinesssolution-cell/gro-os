import { describe, expect, it, vi, beforeEach } from "vitest";

const companyFindUniqueOrThrow = vi.fn();
const companyEvidenceFindFirst = vi.fn();
const companyEvidenceCreate = vi.fn();
const decisionMakerFindMany = vi.fn();
const decisionMakerCreate = vi.fn();
const decisionMakerUpdate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUniqueOrThrow: (...args: unknown[]) => companyFindUniqueOrThrow(...args) },
    companyEvidence: {
      findFirst: (...args: unknown[]) => companyEvidenceFindFirst(...args),
      create: (...args: unknown[]) => companyEvidenceCreate(...args),
    },
    decisionMaker: {
      findMany: (...args: unknown[]) => decisionMakerFindMany(...args),
      create: (...args: unknown[]) => decisionMakerCreate(...args),
      update: (...args: unknown[]) => decisionMakerUpdate(...args),
    },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isOpenCorporatesConfigured = vi.fn();
const openCorporatesSearch = vi.fn();
vi.mock("./providers/opencorporates", () => ({
  isOpenCorporatesConfigured: (...args: unknown[]) => isOpenCorporatesConfigured(...args),
  openCorporatesSearch: (...args: unknown[]) => openCorporatesSearch(...args),
}));

const isCompaniesHouseConfigured = vi.fn();
const companiesHouseSearch = vi.fn();
const companiesHouseOfficers = vi.fn();
vi.mock("./providers/uk-companies-house", () => ({
  isCompaniesHouseConfigured: (...args: unknown[]) => isCompaniesHouseConfigured(...args),
  companiesHouseSearch: (...args: unknown[]) => companiesHouseSearch(...args),
  companiesHouseOfficers: (...args: unknown[]) => companiesHouseOfficers(...args),
}));

const { enrichCompanyRegistry } = await import("./company-registry-waterfall");

const UK_COMPANY = { id: "company-1", organizationId: "org-1", name: "Acme Ltd", headquartersCountry: "United Kingdom" };
const US_COMPANY = { id: "company-2", organizationId: "org-1", name: "Acme Inc", headquartersCountry: "United States" };

describe("company-registry-waterfall.ts — enrichCompanyRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyEvidenceFindFirst.mockResolvedValue(null); // no duplicate fact yet
    decisionMakerFindMany.mockResolvedValue([]);
  });

  it("tries UK Companies House first for a UK-headquartered company, before OpenCorporates", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(UK_COMPANY);
    isCompaniesHouseConfigured.mockReturnValue(true);
    companiesHouseSearch.mockResolvedValue({ ok: true, companies: [{ name: "Acme Ltd", companyNumber: "123", status: "active", incorporationDate: "2010-01-01", registeredAddress: "1 High St", sourceUrl: "https://find-and-update.company-information.service.gov.uk/company/123" }] });
    companiesHouseOfficers.mockResolvedValue({ ok: true, officers: [{ name: "Jane Doe", role: "director", isCurrentlyActive: true }] });
    isOpenCorporatesConfigured.mockReturnValue(true);

    const result = await enrichCompanyRegistry("company-1");

    expect(result.providerUsed).toBe("UK_COMPANIES_HOUSE");
    expect(result.factsWritten).toBe(4);
    expect(result.decisionMakersCreated).toBe(1);
    expect(openCorporatesSearch).not.toHaveBeenCalled();
    expect(decisionMakerCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Jane Doe", role: "DIRECTOR", confidence: 1.0 }) }));
  });

  it("only creates DecisionMaker rows for director-shaped officers, not secretaries", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(UK_COMPANY);
    isCompaniesHouseConfigured.mockReturnValue(true);
    companiesHouseSearch.mockResolvedValue({ ok: true, companies: [{ name: "Acme Ltd", companyNumber: "123" }] });
    companiesHouseOfficers.mockResolvedValue({
      ok: true,
      officers: [
        { name: "Jane Doe", role: "director", isCurrentlyActive: true },
        { name: "John Smith", role: "secretary", isCurrentlyActive: true },
      ],
    });

    const result = await enrichCompanyRegistry("company-1");

    expect(result.decisionMakersCreated).toBe(1);
    expect(decisionMakerCreate).toHaveBeenCalledTimes(1);
    expect(decisionMakerCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Jane Doe" }) }));
  });

  it("refreshes an already-known DecisionMaker's confidence instead of creating a duplicate", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(UK_COMPANY);
    isCompaniesHouseConfigured.mockReturnValue(true);
    companiesHouseSearch.mockResolvedValue({ ok: true, companies: [{ name: "Acme Ltd", companyNumber: "123" }] });
    companiesHouseOfficers.mockResolvedValue({ ok: true, officers: [{ name: "Jane Doe", role: "director", isCurrentlyActive: true }] });
    decisionMakerFindMany.mockResolvedValue([{ id: "dm-1", name: "Jane Doe" }]);

    const result = await enrichCompanyRegistry("company-1");

    expect(result.decisionMakersCreated).toBe(0);
    expect(decisionMakerCreate).not.toHaveBeenCalled();
    expect(decisionMakerUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dm-1" }, data: expect.objectContaining({ confidence: 1.0 }) }));
  });

  it("falls through to OpenCorporates for a non-UK company", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(US_COMPANY);
    isOpenCorporatesConfigured.mockReturnValue(true);
    openCorporatesSearch.mockResolvedValue({ ok: true, companies: [{ name: "Acme Inc", companyNumber: "456", jurisdictionCode: "us_de", currentStatus: "Active" }] });

    const result = await enrichCompanyRegistry("company-2");

    expect(companiesHouseSearch).not.toHaveBeenCalled();
    expect(result.providerUsed).toBe("OPENCORPORATES");
    expect(result.factsWritten).toBeGreaterThan(0);
  });

  it("returns attempted: false (never fabricates a match) when no registry provider is configured", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(US_COMPANY);
    isOpenCorporatesConfigured.mockReturnValue(false);
    isCompaniesHouseConfigured.mockReturnValue(false);

    const result = await enrichCompanyRegistry("company-2");

    expect(result).toEqual({ attempted: false, providerUsed: null, factsWritten: 0, decisionMakersCreated: 0 });
  });

  it("skips writing a duplicate CompanyEvidence fact that already exists from the same source", async () => {
    companyFindUniqueOrThrow.mockResolvedValue(UK_COMPANY);
    isCompaniesHouseConfigured.mockReturnValue(true);
    companiesHouseSearch.mockResolvedValue({ ok: true, companies: [{ name: "Acme Ltd", companyNumber: "123" }] });
    companiesHouseOfficers.mockResolvedValue({ ok: true, officers: [] });
    companyEvidenceFindFirst.mockResolvedValue({ id: "existing-evidence" }); // already recorded

    const result = await enrichCompanyRegistry("company-1");

    expect(companyEvidenceCreate).not.toHaveBeenCalled();
    expect(result.factsWritten).toBe(0);
  });
});
