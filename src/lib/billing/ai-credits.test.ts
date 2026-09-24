import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeApiCostTokens } from "./token-pricing";
import { computeRealApiCostInr, recordAIUsage } from "./ai-credits";

describe("ai-credits.ts — computeRealApiCostInr (real ₹ cost, feeds computeApiCostTokens)", () => {
  it("scales linearly with total tokens for a given provider", () => {
    const oneK = computeRealApiCostInr("ANTHROPIC", 500, 500);
    const twoK = computeRealApiCostInr("ANTHROPIC", 1000, 1000);
    expect(twoK).toBeCloseTo(oneK * 2, 10);
  });

  it("returns 0 for a genuinely zero-token call", () => {
    expect(computeRealApiCostInr("ANTHROPIC", 0, 0)).toBe(0);
  });

  it("prices every provider strictly above 0 for a nonzero call — no provider is silently free", () => {
    const providers = ["ANTHROPIC", "OPENAI", "GOOGLE_GEMINI", "GROQ", "OPENROUTER", "EMBEDDING"] as const;
    for (const provider of providers) {
      expect(computeRealApiCostInr(provider, 1000, 1000)).toBeGreaterThan(0);
    }
  });
});

describe("ai-credits.ts — recordAIUsage wires a real, non-blocking Growth Token debit alongside the AI Credit ledger", () => {
  const suffix = Date.now();
  let orgId: string;
  let billingAccountId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "AI Credits Wiring Org", slug: `ai-credits-wiring-${suffix}` } });
    orgId = org.id;
    const billingAccount = await prisma.billingAccount.create({ data: { organizationId: orgId } });
    billingAccountId = billingAccount.id;
    await prisma.growthTokenLedger.create({
      data: { billingAccountId, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 100_000 },
    });
  });

  afterAll(async () => {
    await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.growthTokenLedger.deleteMany({ where: { billingAccountId } });
    await prisma.aIUsageEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.aICreditLedger.deleteMany({ where: { billingAccountId } });
    await prisma.billingAccount.delete({ where: { id: billingAccountId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("a real SUCCESS call debits both the AICreditLedger and the GrowthTokenLedger", async () => {
    await recordAIUsage(orgId, "ANTHROPIC", "claude-sonnet-5", 1000, 1000, "test:wiring");

    const usageEvent = await prisma.aIUsageEvent.findFirst({ where: { organizationId: orgId, context: "test:wiring" } });
    expect(usageEvent?.creditsUsed).toBeGreaterThan(0); // AICreditLedger's own abstract-credit accounting, unchanged by this wiring

    const realCostInr = computeRealApiCostInr("ANTHROPIC", 1000, 1000);
    const expectedTokens = computeApiCostTokens(realCostInr);

    const tokenLedger = await prisma.growthTokenLedger.findUnique({ where: { billingAccountId } });
    expect(tokenLedger?.purchasedTokensRemaining).toBe(100_000 - expectedTokens);

    const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: orgId, action: "AI_API_USAGE" } });
    expect(events).toHaveLength(1);
    expect(events[0].tokensUsed).toBe(expectedTokens);
    expect(events[0].context).toBe("test:wiring");
  });

  it("a FAILED attempt (0 tokens) never touches the Growth Token ledger", async () => {
    const before = await prisma.growthTokenLedger.findUnique({ where: { billingAccountId } });

    await recordAIUsage(orgId, "ANTHROPIC", "claude-sonnet-5", 0, 0, "test:failed-attempt", "FAILED");

    const after = await prisma.growthTokenLedger.findUnique({ where: { billingAccountId } });
    expect(after?.purchasedTokensRemaining).toBe(before?.purchasedTokensRemaining);

    const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: orgId, context: "test:failed-attempt" } });
    expect(events).toHaveLength(0);
  });
});
