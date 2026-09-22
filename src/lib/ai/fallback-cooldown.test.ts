import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderHttpError } from "./providers/provider-error";

/**
 * Phase 26 — real integration test for the cooldown fix: a provider that
 * fails with a real 429 + Retry-After header gets a real cooldown matching
 * that header (not the flat 60s default), while a provider that fails with
 * no Retry-After still gets the flat default. Every other provider in the
 * chain is mocked as NOT configured so the chain deterministically reaches
 * only the one provider under test, without a real network call.
 */
vi.mock("./providers/gemini-provider", () => ({ geminiProvider: { id: "GOOGLE_GEMINI", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/openai-provider", () => ({ openaiProvider: { id: "OPENAI", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/anthropic-provider", () => ({ anthropicProvider: { id: "ANTHROPIC", model: "test", supportsWebSearch: true, isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/openrouter-provider", () => ({ openrouterProvider: { id: "OPENROUTER", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));

const { groqGenerateText } = vi.hoisted(() => ({ groqGenerateText: vi.fn() }));
vi.mock("./providers/groq-provider", () => ({
  groqProvider: { id: "GROQ", model: "test", isConfigured: () => true, generateText: groqGenerateText, generateStructured: vi.fn() },
}));

import { generateText, __getCooldownStateForTests, __resetCooldownStateForTests, AllAIProvidersFailedError } from "./fallback";

describe("fallback.ts cooldown — real Retry-After honoring", () => {
  beforeEach(() => {
    groqGenerateText.mockReset();
    __resetCooldownStateForTests();
  });

  it("honors a real Retry-After header — cooldown matches the header value, not the flat default", async () => {
    groqGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 429 from GROQ: rate limited", 429, 30_000));

    await expect(generateText({ system: "s", userContent: "u", maxTokens: 100 })).rejects.toThrow(AllAIProvidersFailedError);

    const state = __getCooldownStateForTests("GROQ");
    expect(state?.status).toBe(429);
    expect(state?.cooldownMs).toBe(30_000); // the real header value, not the 60_000 flat default
  });

  it("falls back to the flat default cooldown when no Retry-After is present", async () => {
    groqGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 500 from GROQ: internal error", 500, null));

    await expect(generateText({ system: "s", userContent: "u", maxTokens: 100 })).rejects.toThrow(AllAIProvidersFailedError);

    const state = __getCooldownStateForTests("GROQ");
    expect(state?.status).toBe(500);
    expect(state?.cooldownMs).toBe(60_000); // the real flat default, unchanged behavior for a non-429
  });

  it("caps an absurdly large Retry-After at the real max — never locks a provider out indefinitely", async () => {
    groqGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 429 from GROQ: rate limited", 429, 60 * 60_000)); // 1 hour

    await expect(generateText({ system: "s", userContent: "u", maxTokens: 100 })).rejects.toThrow(AllAIProvidersFailedError);

    const state = __getCooldownStateForTests("GROQ");
    expect(state?.cooldownMs).toBe(5 * 60_000); // capped, not the real 1-hour header value
  });
});
