import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mocked at the real boundaries: Prisma (the DB) and the two provider
 * modules (their own real HTTP calls are each provider file's own concern)
 * — this test proves the waterfall's ORDER and its honest "leave unchanged"
 * terminal case, never the providers' own parsing.
 */
const contactFindUniqueOrThrow = vi.fn();
const contactUpdate = vi.fn();
const contactEvidenceCreate = vi.fn();
const dataProviderCallLogCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findUniqueOrThrow: (...args: unknown[]) => contactFindUniqueOrThrow(...args), update: (...args: unknown[]) => contactUpdate(...args) },
    contactEvidence: { create: (...args: unknown[]) => contactEvidenceCreate(...args) },
    dataProviderCallLog: { create: (...args: unknown[]) => dataProviderCallLogCreate(...args) },
  },
}));

const isHunterConfigured = vi.fn();
const hunterAccountStatus = vi.fn();
const hunterVerifyEmail = vi.fn();
const hunterFindEmail = vi.fn();
vi.mock("./providers/hunter-io", () => ({
  isHunterConfigured: (...args: unknown[]) => isHunterConfigured(...args),
  hunterAccountStatus: (...args: unknown[]) => hunterAccountStatus(...args),
  hunterVerifyEmail: (...args: unknown[]) => hunterVerifyEmail(...args),
  hunterDomainSearch: vi.fn(),
  hunterFindEmail: (...args: unknown[]) => hunterFindEmail(...args),
}));

const isAbstractEmailConfigured = vi.fn();
const abstractValidateEmail = vi.fn();
vi.mock("./providers/abstract-email-validation", () => ({
  isAbstractEmailConfigured: (...args: unknown[]) => isAbstractEmailConfigured(...args),
  abstractValidateEmail: (...args: unknown[]) => abstractValidateEmail(...args),
}));

const isProspeoConfigured = vi.fn();
const prospeoFindEmail = vi.fn();
vi.mock("./providers/prospeo", () => ({
  isProspeoConfigured: (...args: unknown[]) => isProspeoConfigured(...args),
  prospeoFindEmail: (...args: unknown[]) => prospeoFindEmail(...args),
}));

const { verifyContactEmailWaterfall, findRealEmailForPerson } = await import("./email-waterfall");

const CONTACT = { id: "contact-1", organizationId: "org-1", email: "jane@example.com", emailVerificationStatus: "UNVERIFIED" as const };

describe("email-waterfall.ts — verifyContactEmailWaterfall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contactFindUniqueOrThrow.mockResolvedValue(CONTACT);
  });

  it("skips re-checking a contact already confirmed VERIFIED", async () => {
    contactFindUniqueOrThrow.mockResolvedValue({ ...CONTACT, emailVerificationStatus: "VERIFIED" });
    const result = await verifyContactEmailWaterfall("contact-1");
    expect(result.status).toBe("VERIFIED");
    expect(result.providerUsed).toBeNull();
    expect(isHunterConfigured).not.toHaveBeenCalled();
  });

  it("uses Hunter.io first when configured and quota remains", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterAccountStatus.mockResolvedValue({ ok: true, verificationsRemaining: 10, searchesRemaining: 10 });
    hunterVerifyEmail.mockResolvedValue({ ok: true, result: "deliverable", disposable: false });
    isAbstractEmailConfigured.mockReturnValue(true);

    const result = await verifyContactEmailWaterfall("contact-1");

    expect(result.status).toBe("VERIFIED");
    expect(result.providerUsed).toBe("HUNTER_IO");
    expect(abstractValidateEmail).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: "contact-1" }, data: { emailVerificationStatus: "VERIFIED" } });
  });

  it("falls through to Abstract API when Hunter's quota is exhausted — never errors, never fabricates a result", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterAccountStatus.mockResolvedValue({ ok: true, verificationsRemaining: 0, searchesRemaining: 0 });
    isAbstractEmailConfigured.mockReturnValue(true);
    abstractValidateEmail.mockResolvedValue({ ok: true, deliverability: "DELIVERABLE", isDisposable: false });

    const result = await verifyContactEmailWaterfall("contact-1");

    expect(hunterVerifyEmail).not.toHaveBeenCalled();
    expect(result.status).toBe("VERIFIED");
    expect(result.providerUsed).toBe("ABSTRACT_EMAIL_VALIDATION");
  });

  it("falls through to Abstract API when Hunter.io is not configured at all", async () => {
    isHunterConfigured.mockReturnValue(false);
    isAbstractEmailConfigured.mockReturnValue(true);
    abstractValidateEmail.mockResolvedValue({ ok: true, deliverability: "UNDELIVERABLE" });

    const result = await verifyContactEmailWaterfall("contact-1");

    expect(hunterAccountStatus).not.toHaveBeenCalled();
    expect(result.status).toBe("INVALID");
    expect(result.providerUsed).toBe("ABSTRACT_EMAIL_VALIDATION");
  });

  it("leaves the status unchanged (never guesses) when no provider is configured", async () => {
    isHunterConfigured.mockReturnValue(false);
    isAbstractEmailConfigured.mockReturnValue(false);

    const result = await verifyContactEmailWaterfall("contact-1");

    expect(result.status).toBe("UNVERIFIED");
    expect(result.providerUsed).toBeNull();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("leaves the status unchanged when every configured provider fails to return a usable result", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterAccountStatus.mockResolvedValue({ ok: true, verificationsRemaining: 5 });
    hunterVerifyEmail.mockResolvedValue({ ok: false, error: "timeout" });
    isAbstractEmailConfigured.mockReturnValue(true);
    abstractValidateEmail.mockResolvedValue({ ok: false, error: "timeout" });

    const result = await verifyContactEmailWaterfall("contact-1");

    expect(result.status).toBe("UNVERIFIED");
    expect(result.providerUsed).toBeNull();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("logs every attempt to DataProviderCallLog regardless of outcome", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterAccountStatus.mockResolvedValue({ ok: true, verificationsRemaining: 5 });
    hunterVerifyEmail.mockResolvedValue({ ok: true, result: "deliverable" });

    await verifyContactEmailWaterfall("contact-1");

    expect(dataProviderCallLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1", provider: "HUNTER_IO", succeeded: true }),
    });
  });
});

describe("email-waterfall.ts — findRealEmailForPerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Hunter.io first when configured and it finds a real email", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterFindEmail.mockResolvedValue({ ok: true, email: "jane@acme.com", score: 90 });
    isProspeoConfigured.mockReturnValue(true);

    const result = await findRealEmailForPerson("org-1", "acme.com", "Jane", "Doe");

    expect(result).toEqual({ email: "jane@acme.com", score: 90 });
    expect(prospeoFindEmail).not.toHaveBeenCalled();
  });

  it("falls through to Prospeo when Hunter is unconfigured", async () => {
    isHunterConfigured.mockReturnValue(false);
    isProspeoConfigured.mockReturnValue(true);
    prospeoFindEmail.mockResolvedValue({ ok: true, email: "jane@acme.com", emailStatus: "verified" });

    const result = await findRealEmailForPerson("org-1", "acme.com", "Jane", "Doe");

    expect(hunterFindEmail).not.toHaveBeenCalled();
    expect(prospeoFindEmail).toHaveBeenCalledWith("Jane Doe", "https://acme.com");
    expect(result).toEqual({ email: "jane@acme.com", score: null });
  });

  it("falls through to Prospeo when Hunter genuinely finds nothing", async () => {
    isHunterConfigured.mockReturnValue(true);
    hunterFindEmail.mockResolvedValue({ ok: true, email: null });
    isProspeoConfigured.mockReturnValue(true);
    prospeoFindEmail.mockResolvedValue({ ok: true, email: "jane@acme.com" });

    const result = await findRealEmailForPerson("org-1", "acme.com", "Jane", "Doe");

    expect(result.email).toBe("jane@acme.com");
  });

  it("returns null (never guesses) when neither provider is configured", async () => {
    isHunterConfigured.mockReturnValue(false);
    isProspeoConfigured.mockReturnValue(false);

    const result = await findRealEmailForPerson("org-1", "acme.com", "Jane", "Doe");

    expect(result).toEqual({ email: null, score: null });
  });
});
