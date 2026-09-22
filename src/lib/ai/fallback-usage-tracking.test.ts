import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderHttpError } from "./providers/provider-error";

/**
 * Phase 27 (real provider-attempt tracking) — real Postgres integration test
 * proving a genuine failed provider attempt produces a real AIUsageEvent row
 * (status: FAILED, 0 credits, real latencyMs) when `usage` context is given,
 * and that a successful call is NOT double-recorded from fallback.ts itself
 * (every existing call site already owns its own success-path recordAIUsage
 * call — this must not duplicate it).
 */
vi.mock("./providers/gemini-provider", () => ({ geminiProvider: { id: "GOOGLE_GEMINI", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/openai-provider", () => ({ openaiProvider: { id: "OPENAI", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/anthropic-provider", () => ({ anthropicProvider: { id: "ANTHROPIC", model: "test", supportsWebSearch: true, isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));
vi.mock("./providers/openrouter-provider", () => ({ openrouterProvider: { id: "OPENROUTER", model: "test", isConfigured: () => false, generateText: vi.fn(), generateStructured: vi.fn() } }));

const { groqGenerateText } = vi.hoisted(() => ({ groqGenerateText: vi.fn() }));
vi.mock("./providers/groq-provider", () => ({
  groqProvider: { id: "GROQ", model: "test", isConfigured: () => true, generateText: groqGenerateText, generateStructured: vi.fn() },
}));

import { prisma } from "@/lib/prisma";
import { generateText, __resetCooldownStateForTests } from "./fallback";

describe("fallback.ts — real provider-attempt tracking (Phase 27)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Waterfall Test Org", slug: `waterfall-test-${suffix}` } });
    organizationId = org.id;
    await prisma.billingAccount.create({ data: { organizationId } });
  });

  afterAll(async () => {
    await prisma.aIUsageEvent.deleteMany({ where: { organizationId } });
    await prisma.billingAccount.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  beforeEach(() => {
    groqGenerateText.mockReset();
    __resetCooldownStateForTests();
  });

  it("records a real FAILED AIUsageEvent (0 credits, real latencyMs) when a provider fails and usage context is given", async () => {
    groqGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 500 from GROQ: internal error", 500, null));

    await expect(
      generateText({ system: "s", userContent: "u", maxTokens: 100 }, undefined, { organizationId, context: "test:failure" }),
    ).rejects.toThrow();

    // Fire-and-forget write — give it a real tick to land.
    await new Promise((r) => setTimeout(r, 50));

    const events = await prisma.aIUsageEvent.findMany({ where: { organizationId, context: "test:failure" } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("FAILED");
    expect(events[0].provider).toBe("GROQ");
    expect(events[0].inputTokens).toBe(0);
    expect(events[0].outputTokens).toBe(0);
    expect(events[0].creditsUsed).toBe(0);
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does NOT record anything when usage context is omitted — additive rollout, not a forced behavior change for every existing call site", async () => {
    groqGenerateText.mockRejectedValueOnce(new ProviderHttpError("HTTP 500 from GROQ: internal error", 500, null));

    await expect(generateText({ system: "s", userContent: "u", maxTokens: 100 })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));

    const events = await prisma.aIUsageEvent.findMany({ where: { organizationId, provider: "GROQ", status: "FAILED", context: null } });
    expect(events).toHaveLength(0);
  });

  it("does NOT record a success from within fallback.ts itself — real call sites still own that (no double-counting)", async () => {
    groqGenerateText.mockResolvedValueOnce({ text: "ok", inputTokens: 10, outputTokens: 5 });

    const result = await generateText({ system: "s", userContent: "u", maxTokens: 100 }, undefined, { organizationId, context: "test:success" });
    expect(result.text).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    await new Promise((r) => setTimeout(r, 50));
    const events = await prisma.aIUsageEvent.findMany({ where: { organizationId, context: "test:success" } });
    expect(events).toHaveLength(0); // real success recording stays the caller's own responsibility
  });
});
