import type { ZodType } from "zod";

import { anthropicProvider } from "./providers/anthropic-provider";
import { groqProvider } from "./providers/groq-provider";
import { geminiProvider } from "./providers/gemini-provider";
import { openaiProvider } from "./providers/openai-provider";
import { openrouterProvider } from "./providers/openrouter-provider";
import type { AIProviderAdapter, ProviderStructuredRequest, ProviderTextRequest } from "./providers/types";
import type { AIUsageProvider } from "@/generated/prisma/client";
import { enqueueAIFallbackRetry } from "./fallback-queue";

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
 * Soft, per-process circuit breaker. When a provider fails, skip it for the
 * next COOLDOWN_MS instead of re-trying it on every subsequent call — this
 * is what actually keeps cost down when Claude runs out of credit: instead
 * of paying for (and waiting out) a failed Anthropic call on every single
 * agent turn, the chain jumps straight to the free tier for a full minute
 * before probing Claude again. Purely an in-memory optimization (resets on
 * deploy/restart) — never a source of truth for whether a provider is
 * actually configured or down.
 */
const COOLDOWN_MS = 60_000;
const lastFailureAt = new Map<string, number>();

function isCoolingDown(id: string): boolean {
  const failedAt = lastFailureAt.get(id);
  return failedAt !== undefined && Date.now() - failedAt < COOLDOWN_MS;
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

async function runChain<R extends { inputTokens: number; outputTokens: number }>(
  op: (provider: AIProviderAdapter) => Promise<R>,
  queueOnFailure: (FallbackQueueContext & { req: ProviderTextRequest }) | null,
): Promise<{ result: R; provider: AIProviderAdapter }> {
  const attempts: { providerId: string; error: string }[] = [];

  for (const provider of PROVIDER_CHAIN) {
    if (!provider.isConfigured()) continue;
    if (isCoolingDown(provider.id)) continue;

    try {
      const result = await op(provider);
      lastFailureAt.delete(provider.id);
      return { result, provider };
    } catch (error) {
      lastFailureAt.set(provider.id, Date.now());
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ providerId: provider.id, error: message });
      console.warn(`[ai/fallback] ${provider.id} failed, trying next provider:`, message);
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
export async function generateText(req: ProviderTextRequest, queue?: FallbackQueueContext): Promise<FallbackTextResult> {
  const { result, provider } = await runChain((p) => p.generateText(req), queue ? { ...queue, req } : null);
  return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, provider: provider.id, model: provider.model };
}

/**
 * Structured generation through the full fallback chain, validated against
 * `schema` regardless of which provider ends up serving the call (Anthropic
 * enforces it natively; the free tiers validate + one repair round-trip via
 * json-mode.ts). Note: structured requests are not queued for retry on total
 * failure — see fallback-queue.ts's doc comment for why.
 */
export async function generateStructured<T>(req: ProviderStructuredRequest<T> & { schema: ZodType<T> }): Promise<FallbackStructuredResult<T>> {
  const { result, provider } = await runChain((p) => p.generateStructured(req), null);
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    parsed: result.parsed,
    provider: provider.id,
    model: provider.model,
  };
}

/** True if at least one provider in the chain (paid or free) has credentials configured. */
export function isAnyAIProviderConfigured(): boolean {
  return PROVIDER_CHAIN.some((p) => p.isConfigured());
}
