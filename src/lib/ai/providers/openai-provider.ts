import { createOpenAICompatibleProvider } from "./openai-compatible";

/**
 * Second paid provider in the chain, added 2026-09-17 at the org's request
 * so a real, working OpenAI key never sits idle behind the other paid
 * providers — see fallback.ts's PROVIDER_CHAIN ordering. Genuinely
 * OpenAI-compatible (it IS OpenAI), so this reuses the same
 * `/chat/completions` adapter as Groq/OpenRouter rather than a bespoke one.
 * Model is env-overridable (`OPENAI_MODEL`) — defaults to a full (non-mini)
 * flagship chat model, matching Anthropic's own "use the strong model, not
 * the cheap one" choice for a primary/near-primary provider.
 */
export const openaiProvider = createOpenAICompatibleProvider({
  id: "OPENAI",
  model: process.env.OPENAI_MODEL ?? "gpt-5.1",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnvVar: "OPENAI_API_KEY",
  // Confirmed live 2026-09-17: gpt-5.1 rejects the classic `max_tokens` param.
  maxTokensParam: "max_completion_tokens",
});
