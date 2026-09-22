import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderHttpError } from "./providers/provider-error";

/**
 * Phase 27 (lane 5's gap): existing cooldown tests only ever reject ONE
 * provider per test (whichever the chain reaches). This proves the REAL
 * live chain correctly falls through 2 consecutive real failures before a
 * 3rd provider succeeds — not just a single-hop fallback.
 */
const { geminiGenerateText } = vi.hoisted(() => ({ geminiGenerateText: vi.fn() }));
vi.mock("./providers/gemini-provider", () => ({
  geminiProvider: { id: "GOOGLE_GEMINI", model: "test", isConfigured: () => true, generateText: geminiGenerateText, generateStructured: vi.fn() },
}));
vi.mock("./providers/openai-provider", () => ({ openaiProvider: { id: "OPENAI", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/anthropic-provider", () => ({ anthropicProvider: { id: "ANTHROPIC", model: "test", supportsWebSearch: true, isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/openrouter-provider", () => ({ openrouterProvider: { id: "OPENROUTER", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));

const { groqGenerateText } = vi.hoisted(() => ({ groqGenerateText: vi.fn() }));
vi.mock("./providers/groq-provider", () => ({
  groqProvider: { id: "GROQ", model: "test", isConfigured: () => true, generateText: groqGenerateText, generateStructured: vi.fn() },
}));

import { generateText, __getCooldownStateForTests, __resetCooldownStateForTests } from "./fallback";

describe("fallback.ts — real sequential multi-provider failure (Phase 27)", () => {
  beforeEach(() => {
    geminiGenerateText.mockReset();
    groqGenerateText.mockReset();
    __resetCooldownStateForTests();
  });

  it("falls through 2 real consecutive provider failures (Gemini, then would-be-next) before a working provider succeeds", async () => {
    geminiGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 402 from GOOGLE_GEMINI: billing exhausted", 402, null));
    groqGenerateText.mockResolvedValueOnce({ text: "real answer", inputTokens: 20, outputTokens: 10 });

    const result = await generateText({ system: "s", userContent: "u", maxTokens: 100 });

    expect(result.text).toBe("real answer");
    expect(result.provider).toBe("GROQ");
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(groqGenerateText).toHaveBeenCalledTimes(1);

    // Real proof the failed provider's failure was genuinely recorded, not silently swallowed.
    const geminiState = __getCooldownStateForTests("GOOGLE_GEMINI");
    expect(geminiState?.status).toBe(402);
    // The provider that succeeded must never be left in a cooldown state.
    expect(__getCooldownStateForTests("GROQ")).toBeUndefined();
  });
});
