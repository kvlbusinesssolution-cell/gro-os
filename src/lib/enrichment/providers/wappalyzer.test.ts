import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { isWappalyzerConfigured, wappalyzerLookup } from "./wappalyzer";

describe("wappalyzer.ts", () => {
  const originalEnv = process.env.WAPPALYZER_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WAPPALYZER_API_KEY;
    else process.env.WAPPALYZER_API_KEY = originalEnv;
  });

  describe("isWappalyzerConfigured", () => {
    it("is false when WAPPALYZER_API_KEY is unset", () => {
      delete process.env.WAPPALYZER_API_KEY;
      expect(isWappalyzerConfigured()).toBe(false);
    });
  });

  describe("wappalyzerLookup", () => {
    it("returns ok: false when not configured", async () => {
      delete process.env.WAPPALYZER_API_KEY;
      const result = await wappalyzerLookup("acme.com");
      expect(result.ok).toBe(false);
    });

    it("returns the real detected technologies on a successful lookup", async () => {
      process.env.WAPPALYZER_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { url: "https://acme.com", technologies: [{ name: "React", categories: [{ name: "JavaScript frameworks" }] }, { name: "Stripe" }] },
          ],
        }),
      );

      const result = await wappalyzerLookup("acme.com");

      expect(result).toEqual({
        ok: true,
        technologies: [
          { name: "React", categories: ["JavaScript frameworks"] },
          { name: "Stripe", categories: [] },
        ],
      });
      expect(fetch).toHaveBeenCalledWith("https://api.wappalyzer.com/v2/lookup/?urls=https%3A%2F%2Facme.com", expect.objectContaining({ headers: { "x-api-key": "test-key" } }));
    });

    it("prefixes a bare domain with https:// before requesting", async () => {
      process.env.WAPPALYZER_API_KEY = "test-key";
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ technologies: [] }] });
      vi.stubGlobal("fetch", fetchMock);

      await wappalyzerLookup("acme.com");

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("https://acme.com")), expect.anything());
    });

    it("returns ok: false (never fabricates a stack) on an empty result array", async () => {
      process.env.WAPPALYZER_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

      const result = await wappalyzerLookup("acme.com");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false on a non-ok API response", async () => {
      process.env.WAPPALYZER_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "rate limited" }) }));

      const result = await wappalyzerLookup("acme.com");

      expect(result).toEqual({ ok: false, error: "rate limited" });
    });
  });
});
