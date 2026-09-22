import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AGENT_MODEL, getAnthropicClient, isAIConnected } from "@/lib/ai/client";
import type { AIProviderAdapter, ProviderStructuredRequest, ProviderStructuredResponse, ProviderTextRequest, ProviderTextResponse } from "./types";

/**
 * The primary, paid provider — real Claude Opus via the Anthropic SDK. This
 * is a thin wrapper around the exact same client/model this codebase already
 * used before the fallback chain existed (src/lib/ai/client.ts); it does not
 * change Anthropic's own request shape, thinking config, or effort handling.
 * The one Anthropic-only capability the other adapters can't match is the
 * real `web_search_20250305` server tool — honored here when `webSearch` is
 * given, silently unavailable everywhere else in the chain.
 */
export const anthropicProvider: AIProviderAdapter = {
  id: "ANTHROPIC",
  model: AGENT_MODEL,
  supportsWebSearch: true,

  isConfigured(): boolean {
    return isAIConnected();
  },

  async generateText(req: ProviderTextRequest): Promise<ProviderTextResponse> {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: req.maxTokens,
      thinking: { type: "adaptive" },
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
      ...(req.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: req.webSearch.maxUses }] } : {}),
      system: req.system,
      messages: [
        {
          role: "user",
          content: req.image
            ? [{ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64 } }, { type: "text", text: req.userContent }]
            : req.userContent,
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n");

    return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  },

  async generateStructured<T>(req: ProviderStructuredRequest<T>): Promise<ProviderStructuredResponse<T>> {
    const client = getAnthropicClient();
    const response = await client.messages.parse({
      model: AGENT_MODEL,
      max_tokens: req.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort ?? "medium", format: zodOutputFormat(req.schema) },
      system: req.system,
      messages: [{ role: "user", content: req.userContent }],
    });

    if (!response.parsed_output) {
      throw new Error("Anthropic structured output failed schema validation.");
    }

    return {
      text: JSON.stringify(response.parsed_output),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      parsed: response.parsed_output,
    };
  },
};
