import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { isProspeoConfigured, prospeoFindEmail, prospeoEnrichPersonFull } from "./prospeo";

describe("prospeo.ts", () => {
  const originalEnv = process.env.PROSPEO_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PROSPEO_API_KEY;
    else process.env.PROSPEO_API_KEY = originalEnv;
  });

  describe("isProspeoConfigured", () => {
    it("is false when PROSPEO_API_KEY is unset", () => {
      delete process.env.PROSPEO_API_KEY;
      expect(isProspeoConfigured()).toBe(false);
    });

    it("is true when PROSPEO_API_KEY is set", () => {
      process.env.PROSPEO_API_KEY = "test-key";
      expect(isProspeoConfigured()).toBe(true);
    });
  });

  describe("prospeoFindEmail", () => {
    it("returns ok: false (never guesses) when not configured", async () => {
      delete process.env.PROSPEO_API_KEY;
      const result = await prospeoFindEmail("Jane Doe", "https://acme.com");
      expect(result.ok).toBe(false);
    });

    it("returns the real email on a successful response", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: false, response: { email: "jane@acme.com", email_status: "verified" } }) }),
      );

      const result = await prospeoFindEmail("Jane Doe", "https://acme.com");

      expect(result).toEqual({ ok: true, email: "jane@acme.com", emailStatus: "verified" });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.prospeo.io/enrich-person",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-KEY": "test-key" }),
          body: JSON.stringify({ only_verified_email: true, data: { full_name: "Jane Doe", company_website: "https://acme.com" } }),
        }),
      );
    });

    it("returns ok: false (never fabricates an email) when the response has no usable email", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: false, response: { email: null } }) }));

      const result = await prospeoFindEmail("Jane Doe", "https://acme.com");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false on an unexpected response shape rather than guessing", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ something: "unexpected" }) }));

      const result = await prospeoFindEmail("Jane Doe", "https://acme.com");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false on a non-ok API response", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: true, message: "invalid key" }) }));

      const result = await prospeoFindEmail("Jane Doe", "https://acme.com");

      expect(result).toEqual({ ok: false, error: "invalid key" });
    });
  });

  describe("prospeoEnrichPersonFull", () => {
    it("returns ok: false (never guesses) when not configured", async () => {
      delete process.env.PROSPEO_API_KEY;
      const result = await prospeoEnrichPersonFull("Jane Doe", "https://acme.com");
      expect(result.ok).toBe(false);
    });

    it("returns the real mobile and LinkedIn URL on a successful response, without the only_verified_email flag", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: false, response: { mobile: "+1 555 0100", linkedin_url: "https://linkedin.com/in/janedoe" } }) }),
      );

      const result = await prospeoEnrichPersonFull("Jane Doe", "https://acme.com");

      expect(result).toEqual({ ok: true, mobile: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/janedoe" });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.prospeo.io/enrich-person",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-KEY": "test-key" }),
          body: JSON.stringify({ data: { full_name: "Jane Doe", company_website: "https://acme.com" } }),
        }),
      );
    });

    it("returns ok: false (never fabricates) when neither mobile nor linkedin_url is present", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: false, response: { mobile: null, linkedin_url: null } }) }));

      const result = await prospeoEnrichPersonFull("Jane Doe", "https://acme.com");

      expect(result.ok).toBe(false);
    });

    it("returns ok: false on a non-ok API response", async () => {
      process.env.PROSPEO_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: true, message: "invalid key" }) }));

      const result = await prospeoEnrichPersonFull("Jane Doe", "https://acme.com");

      expect(result).toEqual({ ok: false, error: "invalid key" });
    });
  });
});
