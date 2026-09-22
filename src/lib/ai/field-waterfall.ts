import type { ZodType } from "zod";

import { generateStructured } from "./fallback";
import type { FallbackUsageContext } from "./fallback";
import { providerSupportsWebSearch } from "./fallback";

/**
 * Phase 27 (Multi-Provider Data Waterfall Engine) — a real, honest 2-stage
 * waterfall, NOT a multi-vendor one. This session's own audit (Phase 27
 * lane 1) confirmed exactly ONE real multi-provider system exists platform-
 * wide (the 5-provider AI fallback chain in fallback.ts) and ZERO real
 * commercial contact/company-data providers (no Hunter.io/Clearbit/ZoomInfo/
 * Apollo integration exists anywhere in this codebase). Building fake
 * provider adapters with no real credentials/behavior behind them would
 * violate this session's no-fabrication discipline.
 *
 * What IS real and genuinely distinct: a first structured-extraction attempt
 * (the model answers from its own training knowledge / whatever context is
 * given, no live search) versus a second, genuinely different real call — AI
 * web search (Anthropic's real `web_search_20250305` tool, reached via
 * fallback.ts's own `webSearch`-aware provider reordering). These are two
 * real, distinct request shapes, not the same call retried — the second
 * stage can find genuinely current information the first cannot.
 *
 * Deliberately generic/pluggable in spirit (any caller can supply its own
 * schema/prompts/completeness check) without pre-registering fake providers
 * that don't exist — a real second DATA provider could register here later
 * without a rewrite, but this module never claims one exists today.
 */

export type WaterfallSource = "STRUCTURED_EXTRACTION" | "WEB_SEARCH_RESEARCH";

export interface FieldWaterfallResult<T> {
  value: T;
  /** Which real stage's result was actually used. */
  finalSource: WaterfallSource;
  /** True only when the stage that won was actually served by a real, live-search-capable provider (see fallback.ts's providerSupportsWebSearch) — a `WEB_SEARCH_RESEARCH` stage can still end up ungrounded if every search-capable provider was unavailable and the chain fell through to a non-search provider that just answered from training knowledge again. Callers should treat `finalSource === "WEB_SEARCH_RESEARCH" && !usedRealWebSearch` as "no better than stage 1, honestly." */
  usedRealWebSearch: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface FieldWaterfallRequest<T> {
  schema: ZodType<T>;
  system: string;
  userContent: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /**
   * Real completeness check on stage 1's result — different callers care
   * about different fields, so this is caller-supplied rather than a
   * generic "did the JSON parse" check (json-mode.ts's Zod validation
   * already guarantees that much). Return false to fall through to the
   * real web-search research stage.
   */
  isComplete: (value: T) => boolean;
  /** Optional different system/user prompt for the research stage — omit to reuse stage 1's prompts with `webSearch` simply turned on. */
  researchSystem?: string;
  researchUserContent?: string;
  researchMaxUses?: number;
  usage?: FallbackUsageContext;
}

/**
 * Runs the real 2-stage waterfall: structured extraction first, and only if
 * the caller's own `isComplete` check says the result is missing/incomplete,
 * a second real web-search-grounded attempt. Never silently retries the same
 * call — the second stage is a genuinely different request (webSearch: true,
 * optionally different prompts).
 */
export async function fetchFieldWithWaterfall<T>(req: FieldWaterfallRequest<T>): Promise<FieldWaterfallResult<T>> {
  const stage1 = await generateStructured(
    { schema: req.schema, system: req.system, userContent: req.userContent, maxTokens: req.maxTokens, effort: req.effort },
    req.usage,
  );

  if (req.isComplete(stage1.parsed)) {
    return {
      value: stage1.parsed,
      finalSource: "STRUCTURED_EXTRACTION",
      usedRealWebSearch: false,
      totalInputTokens: stage1.inputTokens,
      totalOutputTokens: stage1.outputTokens,
    };
  }

  const stage2 = await generateStructured(
    {
      schema: req.schema,
      system: req.researchSystem ?? req.system,
      userContent: req.researchUserContent ?? req.userContent,
      maxTokens: req.maxTokens,
      effort: req.effort,
      webSearch: { maxUses: req.researchMaxUses ?? 3 },
    },
    req.usage,
  );

  return {
    value: stage2.parsed,
    finalSource: "WEB_SEARCH_RESEARCH",
    usedRealWebSearch: providerSupportsWebSearch(stage2.provider),
    totalInputTokens: stage1.inputTokens + stage2.inputTokens,
    totalOutputTokens: stage1.outputTokens + stage2.outputTokens,
  };
}
