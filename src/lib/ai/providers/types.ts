import type { ZodType } from "zod";
import type { AIUsageProvider } from "@/generated/prisma/client";

/**
 * Provider-agnostic request/response shapes the fallback chain
 * (src/lib/ai/fallback.ts) uses to drive every adapter identically. Anthropic
 * is the only adapter with a real live web-search tool — `webSearch` is a
 * hint the other adapters are free to ignore (and do: see each adapter's
 * comment), not a guarantee.
 */
export interface ProviderTextRequest {
  system: string;
  userContent: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  webSearch?: { maxUses: number };
  /**
   * Real vision input (base64-encoded image bytes) alongside `userContent`.
   * Only Anthropic and Gemini adapters actually support this — Groq/
   * OpenRouter's adapters throw immediately on a request carrying an image,
   * which is deliberate: silently sending a vision-only prompt to a
   * text-only provider would make it hallucinate an answer about an image
   * it never saw, corrupting whatever "extracted text" the caller stores.
   * Throwing lets the fallback chain (fallback.ts) skip straight to the
   * next vision-capable provider instead.
   */
  image?: { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string };
}

export interface ProviderTextResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderStructuredRequest<T> extends ProviderTextRequest {
  schema: ZodType<T>;
}

export interface ProviderStructuredResponse<T> extends ProviderTextResponse {
  parsed: T;
}

/** Thrown by an adapter for any failure that should trigger falling through to the next provider in the chain — auth, rate limit, billing, network, malformed response, whatever. The fallback orchestrator treats every thrown error the same way: log it, try the next provider. */
export class ProviderCallError extends Error {
  constructor(
    public readonly providerId: string,
    cause: unknown,
  ) {
    super(`[${providerId}] ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ProviderCallError";
    this.cause = cause;
  }
}

export interface AIProviderAdapter {
  readonly id: AIUsageProvider;
  readonly model: string;
  /** Pure env-var/config presence check — no network call. */
  isConfigured(): boolean;
  /**
   * True only for a provider with a real, live web-search tool wired in
   * this codebase (currently Anthropic only — see anthropic-provider.ts's
   * `web_search_20250305` tool). Used by fallback.ts's runChain to
   * reorder a `webSearch`-requesting call so a real-search-capable
   * provider is tried before a provider that would otherwise "succeed"
   * with a plausible-looking but non-current, non-grounded answer and
   * short-circuit the chain before it ever reaches a provider that can
   * actually search. Providers that don't declare this default to false.
   */
  readonly supportsWebSearch?: boolean;
  generateText(req: ProviderTextRequest): Promise<ProviderTextResponse>;
  generateStructured<T>(req: ProviderStructuredRequest<T>): Promise<ProviderStructuredResponse<T>>;
}
