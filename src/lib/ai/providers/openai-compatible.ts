import { generateStructuredViaJsonMode } from "./json-mode";
import type { AIProviderAdapter, ProviderStructuredRequest, ProviderStructuredResponse, ProviderTextRequest, ProviderTextResponse } from "./types";
import type { AIUsageProvider } from "@/generated/prisma/client";
import { ProviderHttpError, parseRetryAfterMs } from "./provider-error";

/**
 * Shared implementation for the three providers in the chain that speak the
 * OpenAI-compatible `/chat/completions` shape: OpenAI itself (genuinely is
 * this shape), Groq (documents itself as OpenAI-compatible outright), and
 * OpenRouter (a direct proxy in front of OpenAI-compatible model backends).
 * Gemini is NOT OpenAI-compatible and gets its own adapter
 * (gemini-provider.ts).
 *
 * None of these get the live `web_search` server tool Anthropic has —
 * `webSearch` is accepted but ignored here (with a note appended to the
 * system prompt so the model doesn't silently pretend it searched live).
 * This is a real capability gap versus that provider, not a bug: whenever
 * one of these three ends up serving a call meant for a web-search-capable
 * provider, "answer from training knowledge, honestly labeled as such"
 * beats "the whole agent turn hard-fails."
 */
export function createOpenAICompatibleProvider(config: {
  id: AIUsageProvider;
  model: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  extraHeaders?: Record<string, string>;
  /**
   * Which request-body field carries the output-token cap. Groq and
   * OpenRouter both still accept the classic `max_tokens` (confirmed live
   * against each API). OpenAI's own newer models (gpt-5.x, confirmed live
   * 2026-09-17) reject `max_tokens` outright — "Unsupported parameter" —
   * and require `max_completion_tokens` instead. Defaults to `max_tokens`
   * so the two existing callers don't need to change.
   */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
}): AIProviderAdapter {
  const maxTokensParam = config.maxTokensParam ?? "max_tokens";
  function apiKey(): string | undefined {
    return process.env[config.apiKeyEnvVar];
  }

  async function callRaw(system: string, userContent: string, maxTokens: number, webSearchRequested: boolean, image?: unknown): Promise<ProviderTextResponse> {
    const key = apiKey();
    if (!key) throw new Error(`${config.apiKeyEnvVar} is not configured`);
    // See ProviderTextRequest.image's doc comment (types.ts) — throwing here
    // (rather than silently ignoring the image) lets the fallback chain move
    // to a vision-capable provider instead of hallucinating an answer about
    // an image this integration never actually sent.
    if (image) throw new Error(`${config.id} does not support image input in this integration`);

    const finalSystem = webSearchRequested
      ? `${system}\n\n(Note: live web search is unavailable on this fallback provider. Answer from your training knowledge only, and clearly say so rather than implying you searched the live web.)`
      : system;

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...config.extraHeaders,
      },
      body: JSON.stringify({
        model: config.model,
        [maxTokensParam]: maxTokens,
        messages: [
          { role: "system", content: finalSystem },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderHttpError(`HTTP ${res.status} from ${config.id}: ${body.slice(0, 500)}`, res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    return { text, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
  }

  return {
    id: config.id,
    model: config.model,

    isConfigured(): boolean {
      return !!apiKey();
    },

    async generateText(req: ProviderTextRequest): Promise<ProviderTextResponse> {
      return callRaw(req.system, req.userContent, req.maxTokens, !!req.webSearch, req.image);
    },

    async generateStructured<T>(req: ProviderStructuredRequest<T>): Promise<ProviderStructuredResponse<T>> {
      return generateStructuredViaJsonMode(config.id, (system, userContent) => callRaw(system, userContent, req.maxTokens, !!req.webSearch, req.image), req);
    },
  };
}
