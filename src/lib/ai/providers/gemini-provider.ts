import { generateStructuredViaJsonMode } from "./json-mode";
import type { AIProviderAdapter, ProviderStructuredRequest, ProviderStructuredResponse, ProviderTextRequest, ProviderTextResponse } from "./types";

/**
 * Primary provider (see fallback.ts's PROVIDER_CHAIN) — Google's Gemini API
 * has its own request/response shape (not OpenAI-compatible): auth via a
 * `?key=` query param rather than a Bearer header, `systemInstruction` +
 * `contents` in place of a `messages` array, and `usageMetadata` in place of
 * `usage`. Structured output goes through the same shared JSON-mode + repair
 * pattern as Groq/OpenRouter (see json-mode.ts) rather than Gemini's native
 * `responseSchema`, to keep one battle-tested validation path across every
 * fallback provider instead of three slightly-different schema dialects.
 */
// "gemini-2.5-flash" (the prior default) started 404ing for this key on
// 2026-09-17 ("no longer available to new users") — confirmed live against
// GET /v1beta/models, not guessed. "gemini-flash-latest" is Google's own
// rolling alias for the current recommended flash model, chosen over
// pinning a dated model id again so this doesn't silently go stale the same
// way.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

async function callRaw(
  system: string,
  userContent: string,
  maxTokens: number,
  webSearchRequested: boolean,
  image?: { mediaType: string; base64: string },
): Promise<ProviderTextResponse> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not configured");

  const finalSystem = webSearchRequested
    ? `${system}\n\n(Note: live web search is unavailable on this fallback provider. Answer from your training knowledge only, and clearly say so rather than implying you searched the live web.)`
    : system;

  const parts = image
    ? [{ inline_data: { mime_type: image.mediaType, data: image.base64 } }, { text: userContent }]
    : [{ text: userContent }];

  const res = await fetch(`${BASE_URL}/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: finalSystem }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from GOOGLE_GEMINI: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export const geminiProvider: AIProviderAdapter = {
  id: "GOOGLE_GEMINI",
  model: MODEL,

  isConfigured(): boolean {
    return !!apiKey();
  },

  async generateText(req: ProviderTextRequest): Promise<ProviderTextResponse> {
    return callRaw(req.system, req.userContent, req.maxTokens, !!req.webSearch, req.image);
  },

  async generateStructured<T>(req: ProviderStructuredRequest<T>): Promise<ProviderStructuredResponse<T>> {
    return generateStructuredViaJsonMode("GOOGLE_GEMINI", (system, userContent) => callRaw(system, userContent, req.maxTokens, !!req.webSearch, req.image), req);
  },
};
