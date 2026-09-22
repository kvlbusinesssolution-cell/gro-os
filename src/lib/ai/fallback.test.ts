import { describe, expect, it } from "vitest";

import { chainOrderFor, providerSupportsWebSearch } from "./fallback";

/**
 * Real root-cause fix (2026-09-22): KVL's daily lead-discovery job silently
 * starved once Gemini's billing lapsed, because the fallback chain's normal
 * paid-cost-first order (Gemini -> OpenAI -> Anthropic -> Groq -> OpenRouter)
 * let OpenAI "succeed" with a plausible-looking but non-current, non-grounded
 * answer for a `webSearch`-requesting call and short-circuit the chain
 * (runChain returns on first success) before ever reaching Anthropic, the
 * only provider in this codebase with a real, live web-search tool. These
 * tests verify chainOrderFor's real reordering against the REAL provider
 * chain (not a mock) — see providers/anthropic-provider.ts's
 * `supportsWebSearch: true` and every other provider's lack of it.
 */
describe("chainOrderFor — real web-search-aware provider prioritization", () => {
  it("puts every real search-capable provider (Anthropic) ahead of every non-search provider when webSearch is required", () => {
    const order = chainOrderFor(true).map((p) => p.id);
    const anthropicIndex = order.indexOf("ANTHROPIC");
    expect(anthropicIndex).toBeGreaterThanOrEqual(0);

    // Every provider that comes before Anthropic in this reordered chain
    // must itself be search-capable (there should be none, since Anthropic
    // is the only one — this assertion stays correct even if a second
    // search-capable provider is added later).
    for (const id of order.slice(0, anthropicIndex)) {
      expect(providerSupportsWebSearch(id)).toBe(true);
    }
    // And every provider after it must be non-search (again, true today
    // for OpenAI/Groq/OpenRouter, and stays correct if the roster changes).
    for (const id of order.slice(anthropicIndex + 1)) {
      expect(providerSupportsWebSearch(id)).toBe(false);
    }
  });

  it("keeps Anthropic ahead of Gemini and OpenAI specifically when webSearch is required — the real regression this fixes", () => {
    const order = chainOrderFor(true).map((p) => p.id);
    const anthropicIndex = order.indexOf("ANTHROPIC");
    const geminiIndex = order.indexOf("GOOGLE_GEMINI");
    const openaiIndex = order.indexOf("OPENAI");
    expect(anthropicIndex).toBeLessThan(geminiIndex);
    expect(anthropicIndex).toBeLessThan(openaiIndex);
  });

  it("does NOT reorder the chain at all for a normal (non-webSearch) request — the real paid-cost-first order is untouched", () => {
    const order = chainOrderFor(false).map((p) => p.id);
    expect(order).toEqual(["GOOGLE_GEMINI", "OPENAI", "ANTHROPIC", "GROQ", "OPENROUTER"]);
  });

  it("real chain still contains all 5 real providers when reordered — reordering never drops a provider", () => {
    const reordered = chainOrderFor(true).map((p) => p.id).slice().sort();
    const normal = chainOrderFor(false).map((p) => p.id).slice().sort();
    expect(reordered).toEqual(normal);
  });
});

describe("providerSupportsWebSearch — real capability flag", () => {
  it("is true only for Anthropic among the real provider roster", () => {
    expect(providerSupportsWebSearch("ANTHROPIC")).toBe(true);
    expect(providerSupportsWebSearch("GOOGLE_GEMINI")).toBe(false);
    expect(providerSupportsWebSearch("OPENAI")).toBe(false);
    expect(providerSupportsWebSearch("GROQ")).toBe(false);
    expect(providerSupportsWebSearch("OPENROUTER")).toBe(false);
  });
});
