import { describe, expect, it, vi, beforeEach } from "vitest";

const contactFindUniqueOrThrow = vi.fn();
const contactEvidenceFindMany = vi.fn();
const contactEvidenceFindFirst = vi.fn();
const contactEvidenceCreate = vi.fn();
const contactUpdate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findUniqueOrThrow: (...args: unknown[]) => contactFindUniqueOrThrow(...args), update: (...args: unknown[]) => contactUpdate(...args) },
    contactEvidence: {
      findMany: (...args: unknown[]) => contactEvidenceFindMany(...args),
      findFirst: (...args: unknown[]) => contactEvidenceFindFirst(...args),
      create: (...args: unknown[]) => contactEvidenceCreate(...args),
    },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isProspeoConfigured = vi.fn();
const prospeoEnrichPersonFull = vi.fn();
vi.mock("./providers/prospeo", () => ({
  isProspeoConfigured: (...args: unknown[]) => isProspeoConfigured(...args),
  prospeoEnrichPersonFull: (...args: unknown[]) => prospeoEnrichPersonFull(...args),
}));

const resolveFieldConflict = vi.fn();
vi.mock("@/lib/business-development/evidence-priority", () => ({
  resolveFieldConflict: (...args: unknown[]) => resolveFieldConflict(...args),
}));

const { enrichContactPhoneAndLinkedIn } = await import("./contact-phone-linkedin-finder");

const CONTACT = {
  id: "contact-1",
  organizationId: "org-1",
  firstName: "Jane",
  lastName: "Doe",
  phone: null as string | null,
  linkedin: null as string | null,
  company: { website: "https://acme.com", domain: "acme.com" } as { website: string | null; domain: string | null } | null,
};

describe("contact-phone-linkedin-finder.ts — enrichContactPhoneAndLinkedIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactFindUniqueOrThrow.mockResolvedValue(CONTACT);
    contactEvidenceFindMany.mockResolvedValue([]);
    contactEvidenceFindFirst.mockResolvedValue(null);
    resolveFieldConflict.mockReturnValue({ shouldApplyToCompanyField: true });
  });

  it("does not attempt a lookup when Prospeo is not configured", async () => {
    isProspeoConfigured.mockReturnValue(false);

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: false, phoneFound: false, linkedinFound: false });
    expect(prospeoEnrichPersonFull).not.toHaveBeenCalled();
  });

  it("does nothing when the contact already has both phone and linkedin — fill-when-empty", async () => {
    isProspeoConfigured.mockReturnValue(true);
    contactFindUniqueOrThrow.mockResolvedValue({ ...CONTACT, phone: "+1 555 0100", linkedin: "https://linkedin.com/in/janedoe" });

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: false, phoneFound: false, linkedinFound: false });
    expect(prospeoEnrichPersonFull).not.toHaveBeenCalled();
  });

  it("does nothing when the contact's company has no website/domain", async () => {
    isProspeoConfigured.mockReturnValue(true);
    contactFindUniqueOrThrow.mockResolvedValue({ ...CONTACT, company: null });

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: false, phoneFound: false, linkedinFound: false });
    expect(prospeoEnrichPersonFull).not.toHaveBeenCalled();
  });

  it("writes real ContactEvidence + Contact.phone/linkedin when both are found", async () => {
    isProspeoConfigured.mockReturnValue(true);
    prospeoEnrichPersonFull.mockResolvedValue({ ok: true, mobile: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/janedoe" });

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: true, phoneFound: true, linkedinFound: true });
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "contact-1" }, data: { phone: "+1 555 0100" } });
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "contact-1" }, data: { linkedin: "https://linkedin.com/in/janedoe" } });
    expect(contactEvidenceCreate).toHaveBeenCalledTimes(2);
  });

  it("only fills the field that is actually missing", async () => {
    isProspeoConfigured.mockReturnValue(true);
    contactFindUniqueOrThrow.mockResolvedValue({ ...CONTACT, linkedin: "https://linkedin.com/in/janedoe" });
    prospeoEnrichPersonFull.mockResolvedValue({ ok: true, mobile: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/someone-else" });

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: true, phoneFound: true, linkedinFound: false });
    expect(contactUpdate).toHaveBeenCalledTimes(1);
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "contact-1" }, data: { phone: "+1 555 0100" } });
  });

  it("returns attempted: true with nothing found (never fabricates) when the provider call fails", async () => {
    isProspeoConfigured.mockReturnValue(true);
    prospeoEnrichPersonFull.mockResolvedValue({ ok: false, error: "No mobile or LinkedIn URL found" });

    const result = await enrichContactPhoneAndLinkedIn("contact-1");

    expect(result).toEqual({ attempted: true, phoneFound: false, linkedinFound: false });
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});
