import { createOpenAICompatibleProvider } from "./openai-compatible";

/**
 * Free-tier fallback in the chain — Groq's free tier is fast, has a
 * generous free request/token allowance, and (via `openai/gpt-oss-120b`)
 * follows instructions well enough for this app's structured-output prompts.
 * `llama-3.3-70b-versatile` (the prior default) was retired from Groq's
 * catalog — confirmed 2026-09-17 via a live GET /openai/v1/models call, not
 * guessed. Model is env-overridable (`GROQ_MODEL`) so ops can move to a
 * newer hosted model without a code change if Groq deprecates this one too.
 */
export const groqProvider = createOpenAICompatibleProvider({
  id: "GROQ",
  model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKeyEnvVar: "GROQ_API_KEY",
});
