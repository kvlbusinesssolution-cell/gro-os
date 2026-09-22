import { describe, expect, it } from "vitest";

import { ProviderHttpError, classifyProviderError, parseRetryAfterMs } from "./provider-error";

describe("parseRetryAfterMs — real Retry-After header parsing", () => {
  it("parses a real numeric-seconds header into milliseconds", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });

  it("returns null for a missing header", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("returns null for a non-numeric value (e.g. an HTTP-date, deliberately not parsed)", () => {
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });

  it("returns null for a negative number — never a nonsensical negative cooldown", () => {
    expect(parseRetryAfterMs("-5")).toBeNull();
  });

  it("accepts a real zero-second Retry-After", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });
});

describe("classifyProviderError — real error-shape classification", () => {
  it("reads status + retryAfterMs directly off a real ProviderHttpError", () => {
    const error = new ProviderHttpError("HTTP 429 from GROQ: rate limited", 429, 30_000);
    expect(classifyProviderError(error)).toEqual({ status: 429, retryAfterMs: 30_000 });
  });

  it("duck-types a real Anthropic-SDK-shaped error (status + headers.get)", () => {
    const sdkLikeError = {
      status: 429,
      headers: { get: (name: string) => (name === "retry-after" ? "45" : null) },
    };
    expect(classifyProviderError(sdkLikeError)).toEqual({ status: 429, retryAfterMs: 45_000 });
  });

  it("falls back to parsing a real 'HTTP nnn from' message for an un-migrated plain Error", () => {
    const error = new Error("HTTP 503 from GOOGLE_GEMINI: service unavailable");
    expect(classifyProviderError(error)).toEqual({ status: 503, retryAfterMs: null });
  });

  it("returns null status for a genuinely unrecognizable error shape — never a guessed status", () => {
    const error = new Error("fetch failed: network error");
    expect(classifyProviderError(error)).toEqual({ status: null, retryAfterMs: null });
  });

  it("returns null retryAfterMs for an SDK-shaped error with no retry-after header present", () => {
    const sdkLikeError = { status: 500, headers: { get: () => null } };
    expect(classifyProviderError(sdkLikeError)).toEqual({ status: 500, retryAfterMs: null });
  });
});
