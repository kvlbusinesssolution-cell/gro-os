import { describe, expect, it, vi } from "vitest";

/**
 * Phase 30 (Enterprise Email Deliverability Engine) — real tests for Phase
 * 4's already-real but previously-untested DNS-based domain-health check.
 * Mocked at the real, honest boundary: Node's own `node:dns` module (the
 * one real external dependency this function has) — never faking the
 * SPF/DMARC parsing logic itself, only the actual DNS resolver response.
 */
const resolveTxt = vi.fn();
vi.mock("node:dns", () => ({
  promises: {
    resolveTxt: (...args: unknown[]) => resolveTxt(...args),
  },
}));

const { checkDomainHealth } = await import("./domain-health");

describe("checkDomainHealth", () => {
  it("reports GOOD for a domain with a real valid SPF record and a real strict DMARC policy", async () => {
    resolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "good-domain.com") return [["v=spf1 include:_spf.resend.com ~all"]];
      if (hostname === "_dmarc.good-domain.com") return [["v=DMARC1; p=reject; rua=mailto:dmarc@good-domain.com"]];
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("good-domain.com");
    expect(result.spf.status).toBe("GOOD");
    expect(result.dmarc.status).toBe("GOOD");
    expect(result.dkim.status).toBe("NOT_VERIFIED"); // honestly never claims to verify DKIM
  });

  it("reports CRITICAL for SPF when no real SPF TXT record exists", async () => {
    resolveTxt.mockImplementation(async () => {
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("no-spf-domain.com");
    expect(result.spf.status).toBe("CRITICAL");
    expect(result.spf.detail).toContain("No SPF TXT record found");
  });

  it("downgrades DMARC to WARNING for a real p=none monitor-only policy", async () => {
    resolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "monitor-only.com") return [["v=spf1 ~all"]];
      if (hostname === "_dmarc.monitor-only.com") return [["v=DMARC1; p=none;"]];
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("monitor-only.com");
    expect(result.dmarc.status).toBe("WARNING");
    expect(result.dmarc.detail).toContain("p=none");
  });

  it("reports WARNING for DMARC when no real DMARC record exists at all", async () => {
    resolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "no-dmarc.com") return [["v=spf1 ~all"]];
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("no-dmarc.com");
    expect(result.dmarc.status).toBe("WARNING");
    expect(result.dmarc.detail).toContain("No DMARC TXT record found");
  });

  it("never fabricates a DKIM pass — always NOT_VERIFIED regardless of SPF/DMARC outcome", async () => {
    resolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "perfect-domain.com") return [["v=spf1 include:_spf.resend.com -all"]];
      if (hostname === "_dmarc.perfect-domain.com") return [["v=DMARC1; p=reject;"]];
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("perfect-domain.com");
    expect(result.dkim.status).toBe("NOT_VERIFIED");
    expect(result.dkim.detail).toContain("not reliably checkable");
  });

  it("correctly ignores a real TXT record that isn't actually SPF/DMARC-shaped", async () => {
    resolveTxt.mockImplementation(async (hostname: string) => {
      if (hostname === "unrelated-txt.com") return [["google-site-verification=abc123"]];
      throw new Error("NXDOMAIN");
    });

    const result = await checkDomainHealth("unrelated-txt.com");
    expect(result.spf.status).toBe("CRITICAL"); // real unrelated TXT record correctly not mistaken for SPF
  });
});
