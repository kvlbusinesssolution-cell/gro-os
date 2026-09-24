import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { isSecEdgarConfigured, edgarFindFormDFilings } from "./sec-edgar";

describe("sec-edgar.ts", () => {
  const originalEnv = process.env.SEC_EDGAR_USER_AGENT;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SEC_EDGAR_USER_AGENT;
    else process.env.SEC_EDGAR_USER_AGENT = originalEnv;
  });

  describe("isSecEdgarConfigured", () => {
    it("is false when SEC_EDGAR_USER_AGENT is unset", () => {
      delete process.env.SEC_EDGAR_USER_AGENT;
      expect(isSecEdgarConfigured()).toBe(false);
    });

    it("is true when SEC_EDGAR_USER_AGENT is set", () => {
      process.env.SEC_EDGAR_USER_AGENT = "KVL GrowthOS contact@kvl.com";
      expect(isSecEdgarConfigured()).toBe(true);
    });
  });

  describe("edgarFindFormDFilings", () => {
    it("returns ok: false (never guesses) when not configured", async () => {
      delete process.env.SEC_EDGAR_USER_AGENT;
      const result = await edgarFindFormDFilings("Acme Corp");
      expect(result.ok).toBe(false);
    });

    it("sends the required User-Agent header on every request", async () => {
      process.env.SEC_EDGAR_USER_AGENT = "KVL GrowthOS contact@kvl.com";
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: { hits: [] } }) });
      vi.stubGlobal("fetch", fetchMock);

      await edgarFindFormDFilings("Acme Corp");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("forms=D"), { headers: { "User-Agent": "KVL GrowthOS contact@kvl.com" } });
    });

    it("returns ok: true with an empty array (never fabricates) when no filings match", async () => {
      process.env.SEC_EDGAR_USER_AGENT = "KVL GrowthOS contact@kvl.com";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: { hits: [] } }) }));

      const result = await edgarFindFormDFilings("Some Private Company LLC");

      expect(result).toEqual({ ok: true, filings: [] });
    });

    it("returns the real filing details from a matching hit", async () => {
      process.env.SEC_EDGAR_USER_AGENT = "KVL GrowthOS contact@kvl.com";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            hits: { hits: [{ _source: { file_date: "2026-03-01", adsh: "0001234567-26-000123", root_forms: ["D"], display_names: ["ACME CORP"] } }] },
          }),
        }),
      );

      const result = await edgarFindFormDFilings("Acme Corp");

      expect(result).toEqual({
        ok: true,
        filings: [{ filingDate: "2026-03-01", accessionNumber: "0001234567-26-000123", formType: "D", entityName: "ACME CORP" }],
      });
    });

    it("returns ok: false on a non-ok API response", async () => {
      process.env.SEC_EDGAR_USER_AGENT = "KVL GrowthOS contact@kvl.com";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));

      const result = await edgarFindFormDFilings("Acme Corp");

      expect(result.ok).toBe(false);
    });
  });
});
