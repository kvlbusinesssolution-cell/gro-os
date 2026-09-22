import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { generateStructuredMock, providerSupportsWebSearchMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
  providerSupportsWebSearchMock: vi.fn(),
}));
vi.mock("./fallback", () => ({
  generateStructured: generateStructuredMock,
  providerSupportsWebSearch: providerSupportsWebSearchMock,
}));

import { fetchFieldWithWaterfall } from "./field-waterfall";

const schema = z.object({ value: z.string() });

describe("field-waterfall.ts — real 2-stage waterfall (Phase 27)", () => {
  beforeEach(() => {
    generateStructuredMock.mockReset();
    providerSupportsWebSearchMock.mockReset();
  });

  it("uses stage 1 (structured extraction) and never calls stage 2 when the caller's isComplete says it's already complete", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      text: "{}",
      parsed: { value: "found" },
      inputTokens: 10,
      outputTokens: 5,
      provider: "GOOGLE_GEMINI",
      model: "test",
      latencyMs: 100,
    });

    const result = await fetchFieldWithWaterfall({
      schema,
      system: "s",
      userContent: "u",
      maxTokens: 100,
      isComplete: (v) => v.value === "found",
    });

    expect(result.finalSource).toBe("STRUCTURED_EXTRACTION");
    expect(result.usedRealWebSearch).toBe(false);
    expect(result.value).toEqual({ value: "found" });
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    // Stage 1 must never request webSearch — that's what makes it a genuinely different second stage.
    expect(generateStructuredMock.mock.calls[0][0].webSearch).toBeUndefined();
  });

  it("falls through to stage 2 (real web-search research) when stage 1 is incomplete, and reports the real winning source", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "" }, inputTokens: 10, outputTokens: 5, provider: "GOOGLE_GEMINI", model: "test", latencyMs: 100 })
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "researched" }, inputTokens: 20, outputTokens: 8, provider: "ANTHROPIC", model: "test", latencyMs: 300 });
    providerSupportsWebSearchMock.mockReturnValueOnce(true);

    const result = await fetchFieldWithWaterfall({
      schema,
      system: "s",
      userContent: "u",
      maxTokens: 100,
      isComplete: (v) => v.value.length > 0,
    });

    expect(result.finalSource).toBe("WEB_SEARCH_RESEARCH");
    expect(result.usedRealWebSearch).toBe(true);
    expect(result.value).toEqual({ value: "researched" });
    expect(result.totalInputTokens).toBe(30);
    expect(result.totalOutputTokens).toBe(13);
    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    // Stage 2 must genuinely request real web search — the whole point of the second stage.
    expect(generateStructuredMock.mock.calls[1][0].webSearch).toEqual({ maxUses: 3 });
  });

  it("honestly reports usedRealWebSearch: false when stage 2 falls through to a non-search provider too — never claims a real search happened when it didn't", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "" }, inputTokens: 10, outputTokens: 5, provider: "GOOGLE_GEMINI", model: "test", latencyMs: 100 })
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "ungrounded guess" }, inputTokens: 15, outputTokens: 6, provider: "OPENAI", model: "test", latencyMs: 200 });
    providerSupportsWebSearchMock.mockReturnValueOnce(false); // OPENAI has no real search capability

    const result = await fetchFieldWithWaterfall({
      schema,
      system: "s",
      userContent: "u",
      maxTokens: 100,
      isComplete: (v) => v.value.length > 0,
    });

    expect(result.finalSource).toBe("WEB_SEARCH_RESEARCH");
    expect(result.usedRealWebSearch).toBe(false); // honest — same shape as stage 2, but not actually grounded
  });

  it("threads a custom research prompt and maxUses through to stage 2 when given", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "" }, inputTokens: 10, outputTokens: 5, provider: "GOOGLE_GEMINI", model: "test", latencyMs: 100 })
      .mockResolvedValueOnce({ text: "{}", parsed: { value: "x" }, inputTokens: 10, outputTokens: 5, provider: "ANTHROPIC", model: "test", latencyMs: 100 });
    providerSupportsWebSearchMock.mockReturnValueOnce(true);

    await fetchFieldWithWaterfall({
      schema,
      system: "s",
      userContent: "u",
      researchUserContent: "different research prompt",
      researchMaxUses: 5,
      maxTokens: 100,
      isComplete: (v) => v.value.length > 0,
    });

    expect(generateStructuredMock.mock.calls[1][0].userContent).toBe("different research prompt");
    expect(generateStructuredMock.mock.calls[1][0].webSearch).toEqual({ maxUses: 5 });
  });
});
