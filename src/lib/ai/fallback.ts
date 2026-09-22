import type { ZodType } from "zod";

import { anthropicProvider } from "./providers/anthropic-provider";
import { groqProvider } from "./providers/groq-provider";
import { geminiProvider } from "./providers/gemini-provider";
import { openaiProvider } from "./providers/openai-provider";
import { openrouterProvider } from "./providers/openrouter-provider";
import type { AIProviderAdapter, ProviderStructuredRequest, ProviderTextRequest } from "./providers/types";
import type { AIUsageProvider } from "@/generated/prisma/client";
import { enqueueAIFallbackRetry } from "./fallback-queue";
import { classifyProviderError } from "./providers/provider-error";
import { recordAIUsage } from "@/lib/billing/ai-credits";

/**
 * The real provider cascade: paid Gemini first — the org is paying for real
 * Gemini quota and wants it actually spent, not left idle behind Claude —
 * then paid OpenAI second (added 2026-09-17, same "don't let a paid key sit
 * idle" reasoning), then paid Claude third (still the model every prompt in
 * this codebase was actually tuned against, so quality never regresses once
 * Gemini and OpenAI are both unavailable), then two free tiers as a last
 * resort (Groq's free tier is fast and reliable; OpenRouter's free-model
 * routing is the final fallback before giving up entirely). Three
 * independent paid providers ahead of the free tier means an outage or
 * billing lapse on any one of them never actually interrupts marketing
 * output — there's always real capacity left in the chain.
 */
const PROVIDER_CHAIN: AIProviderAdapter[] = [geminiProvider, openaiProvider, anthropicProvider, groqProvider, openrouterProvider];

/**
 * Soft, per-process circuit breaker. When a provider fails, skip it for a
 * real cooldown window instead of re-trying it on every subsequent call —
 * this is what actually keeps cost down when Claude runs out of credit:
 * instead of paying for (and waiting out) a failed Anthropic call on every
 * single agent turn, the chain jumps straight to the free tier before
 * probing Claude again. Purely an in-memory optimization (resets on
 * deploy/restart) — never a source of truth for whether a provider is
 * actually configured or down.
 *
 * Phase 26 (real, minimal provider-state fix): the cooldown duration is no
 * longer a flat guess for every failure — when the provider sent a real
 * `Retry-After` header (a genuine RATE_LIMITED/429 signal, distinct from a
 * generic FAILED), that real value is honored (capped at
 * MAX_RETRY_COOLDOWN_MS so a broken/huge header can't lock a provider out
 * indefinitely). Every other failure (5xx, network error, etc.) still gets
 * the flat DEFAULT_COOLDOWN_MS — this is deliberately NOT a persisted
 * provider-health-history table or a live health dashboard; both are
 * Phase 27's explicit "provider health monitoring" scope.
 */
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_RETRY_COOLDOWN_MS = 5 * 60_000;
interface CooldownState {
  failedAt: number;
  cooldownMs: number;
  /** Real HTTP status from the failure, when known — null for a non-HTTP error (e.g. a thrown network exception). Exposed for observability/tests, not read by any other logic here. */
  status: number | null;
}
const cooldownState = new Map<string, CooldownState>();

function isCoolingDown(id: string): boolean {
  const state = cooldownState.get(id);
  return state !== undefined && Date.now() - state.failedAt < state.cooldownMs;
}

function recordFailure(id: string, error: unknown): CooldownState {
  const { status, retryAfterMs } = classifyProviderError(error);
  const cooldownMs = retryAfterMs !== null ? Math.min(retryAfterMs, MAX_RETRY_COOLDOWN_MS) : DEFAULT_COOLDOWN_MS;
  const state: CooldownState = { failedAt: Date.now(), cooldownMs, status };
  cooldownState.set(id, state);
  return state;
}

/** Test-only escape hatch — the cooldown map is real module-level state that would otherwise leak between test cases. */
export function __resetCooldownStateForTests(): void {
  cooldownState.clear();
}

/** Test-only introspection — lets a test confirm the real recorded cooldown duration (e.g. a real Retry-After value) without exposing the map itself. */
export function __getCooldownStateForTests(id: string): CooldownState | undefined {
  return cooldownState.get(id);
}

export class AllAIProvidersFailedError extends Error {
  constructor(public readonly attempts: { providerId: string; error: string }[]) {
    super(`All AI providers failed: ${attempts.map((a) => `${a.providerId}: ${a.error}`).join("; ") || "no provider is configured"}`);
    this.name = "AllAIProvidersFailedError";
  }
}

export interface FallbackTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: AIUsageProvider;
  model: string;
  /** Phase 27: real wall-clock duration of the successful attempt, in milliseconds. Additive — existing callers that don't read this field are unaffected. */
  latencyMs: number;
}

export interface FallbackStructuredResult<T> extends FallbackTextResult {
  parsed: T;
}

/** Context used only for the durable retry queue when every provider in the chain fails — see fallback-queue.ts. Optional: omit for calls that shouldn't be queued for later retry (e.g. best-effort/non-critical paths). */
export interface FallbackQueueContext {
  organizationId?: string;
  agentId?: string;
  context: string;
}

/**
 * Phase 27 (real provider-attempt tracking, requirement: provider_attempts/
 * provider_failure/provider_latency/final_source). Optional and additive —
 * when given, every individual provider FAILURE in the chain (not just the
 * final outcome) gets a real AIUsageEvent row (status: FAILED, 0 tokens/
 * credits, real latencyMs, real classified status from provider-error.ts).
 * Deliberately does NOT record on success here — every existing call site
 * already owns its own real recordAIUsage(...) call after a successful
 * response (see agent-runtime.ts's recordAgentAIUsage and 40+ others);
 * duplicating that here would double-count real credits. This is a
 * best-effort rollout, not yet wired into every one of those call sites —
 * omitting `usage` simply means failures for that call aren't tracked yet,
 * same as today.
 */
export interface FallbackUsageContext {
  organizationId: string;
  context?: string;
}

/**
 * Real, live web search only works through a provider whose adapter
 * declares `supportsWebSearch: true` (currently Anthropic alone — see
 * types.ts's doc comment). PROVIDER_CHAIN's normal cost-driven order
 * (paid-first) is wrong for a `webSearch`-requesting call: Gemini/OpenAI
 * would "succeed" with a plausible-looking but non-current, non-grounded
 * answer and short-circuit the chain (runChain returns on first success)
 * before ever reaching the one provider that can actually search — this is
 * exactly what silently starved KVL's lead-discovery job once Gemini's
 * billing lapsed (2026-09-22 root cause). For a search-requiring call, this
 * moves every supportsWebSearch provider ahead of the rest, preserving
 * PROVIDER_CHAIN's relative order within each group — a real search
 * attempt is always made first when one is possible, and the existing
 * non-search graceful-degradation fallback is still reached afterward if
 * every real-search provider is unavailable.
 */
export function chainOrderFor(requiresWebSearch: boolean): AIProviderAdapter[] {
  if (!requiresWebSearch) return PROVIDER_CHAIN;
  const searchCapable = PROVIDER_CHAIN.filter((p) => p.supportsWebSearch);
  const rest = PROVIDER_CHAIN.filter((p) => !p.supportsWebSearch);
  return [...searchCapable, ...rest];
}

async function runChain<R extends { inputTokens: number; outputTokens: number }>(
  op: (provider: AIProviderAdapter) => Promise<R>,
  queueOnFailure: (FallbackQueueContext & { req: ProviderTextRequest }) | null,
  requiresWebSearch = false,
  usage?: FallbackUsageContext,
): Promise<{ result: R; provider: AIProviderAdapter; latencyMs: number }> {
  const attempts: { providerId: string; error: string }[] = [];

  for (const provider of chainOrderFor(requiresWebSearch)) {
    if (!provider.isConfigured()) continue;
    if (isCoolingDown(provider.id)) continue;

    const attemptStartedAt = Date.now();
    try {
      const result = await op(provider);
      cooldownState.delete(provider.id);
      return { result, provider, latencyMs: Date.now() - attemptStartedAt };
    } catch (error) {
      const latencyMs = Date.now() - attemptStartedAt;
      const state = recordFailure(provider.id, error);
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ providerId: provider.id, error: message });
      console.warn(
        `[ai/fallback] ${provider.id} failed (status=${state.status ?? "unknown"}, cooldown=${state.cooldownMs}ms), trying next provider:`,
        message,
      );
      if (usage) {
        recordAIUsage(usage.organizationId, provider.id, provider.model, 0, 0, usage.context, "FAILED", latencyMs).catch(() => {
          // recordAIUsage already logs its own failures internally — never let a tracking failure affect the real fallback loop.
        });
      }
    }
  }

  if (queueOnFailure) {
    await enqueueAIFallbackRetry({
      organizationId: queueOnFailure.organizationId,
      agentId: queueOnFailure.agentId,
      context: queueOnFailure.context,
      system: queueOnFailure.req.system,
      userContent: queueOnFailure.req.userContent,
      maxTokens: queueOnFailure.req.maxTokens,
      effort: queueOnFailure.req.effort,
    }).catch((error) => console.error("[ai/fallback] failed to enqueue retry job:", error));
  }

  throw new AllAIProvidersFailedError(attempts);
}

/**
 * Plain-text generation through the full fallback chain. `queue`, when
 * given, durably queues one retry (via BullMQ — see fallback-queue.ts) if
 * every provider in the chain fails, so a full-chain outage degrades to
 * "retried automatically later" instead of a hard, final failure.
 */
export async function generateText(req: ProviderTextRequest, queue?: FallbackQueueContext, usage?: FallbackUsageContext): Promise<FallbackTextResult> {
  const { result, provider, latencyMs } = await runChain((p) => p.generateText(req), queue ? { ...queue, req } : null, !!req.webSearch, usage);
  return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, provider: provider.id, model: provider.model, latencyMs };
}

/**
 * Structured generation through the full fallback chain, validated against
 * `schema` regardless of which provider ends up serving the call (Anthropic
 * enforces it natively; the free tiers validate + one repair round-trip via
 * json-mode.ts). Note: structured requests are not queued for retry on total
 * failure — see fallback-queue.ts's doc comment for why.
 */
export async function generateStructured<T>(
  req: ProviderStructuredRequest<T> & { schema: ZodType<T> },
  usage?: FallbackUsageContext,
): Promise<FallbackStructuredResult<T>> {
  const { result, provider, latencyMs } = await runChain((p) => p.generateStructured(req), null, !!req.webSearch, usage);
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    parsed: result.parsed,
    provider: provider.id,
    model: provider.model,
    latencyMs,
  };
}

/** True if at least one provider in the chain (paid or free) has credentials configured. */
export function isAnyAIProviderConfigured(): boolean {
  return PROVIDER_CHAIN.some((p) => p.isConfigured());
}

/** True when `providerId` is one that actually performed real, live web search for a `webSearch`-requesting call — callers like runWebSearchDiscovery use this on the returned `provider` field to tell a real, current search from a same-shaped-but-ungrounded fallback answer. */
export function providerSupportsWebSearch(providerId: AIUsageProvider): boolean {
  return PROVIDER_CHAIN.some((p) => p.id === providerId && p.supportsWebSearch);
}
