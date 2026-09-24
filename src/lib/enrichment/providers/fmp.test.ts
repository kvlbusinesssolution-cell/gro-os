import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { isFmpConfigured, fmpSearchSymbol, fmpCompanyProfile } from "./fmp";

describe("fmp.ts", () => {
  const originalEnv = process.env.FMP_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = originalEnv;
  });

  describe("isFmpConfigured", () => {
    it("is false when FMP_API_KEY is unset", () => {
      delete process.env.FMP_API_KEY;
      expect(isFmpConfigured()).toBe(false);
    });

    it("is true when FMP_API_KEY is set", () => {
      process.env.FMP_API_KEY = "test-key";
      expect(isFmpConfigured()).toBe(true);
    });
  });

  describe("fmpSearchSymbol", () => {
    it("returns ok: false when not configured", async () => {
      delete process.env.FMP_API_KEY;
      const result = await fmpSearchSymbol("Acme Corp");
      expect(result.ok).toBe(false);
    });

    it("returns the real symbol on a match", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ symbol: "ACME", name: "Acme Corp" }] }));

      const result = await fmpSearchSymbol("Acme Corp");

      expect(result).toEqual({ ok: true, symbol: "ACME" });
    });

    it("returns ok: false (never guesses) when there is no matching symbol", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

      const result = await fmpSearchSymbol("Some Private Company LLC");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false on a non-ok API response", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));

      const result = await fmpSearchSymbol("Acme Corp");

      expect(result.ok).toBe(false);
    });
  });

  describe("fmpCompanyProfile", () => {
    it("returns ok: false when not configured", async () => {
      delete process.env.FMP_API_KEY;
      const result = await fmpCompanyProfile("ACME");
      expect(result.ok).toBe(false);
    });

    it("returns the real full-time employee count on a successful lookup", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ symbol: "ACME", fullTimeEmployees: "1250" }] }));

      const result = await fmpCompanyProfile("ACME");

      expect(result).toEqual({ ok: true, fullTimeEmployees: 1250 });
    });

    it("returns ok: false (never fabricates) when no employee count is reported", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ symbol: "ACME", fullTimeEmployees: null }] }));

      const result = await fmpCompanyProfile("ACME");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false when the symbol has no profile at all", async () => {
      process.env.FMP_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

      const result = await fmpCompanyProfile("ACME");

      expect(result.ok).toBe(false);
    });
  });
});
