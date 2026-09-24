import { prisma } from "@/lib/prisma";
import type { AIUsageProvider, AIUsageStatus } from "@/generated/prisma/client";
import { recordApiUsageTokenSpend } from "./growth-tokens";

/**
 * AI Credit System — meters real Claude/OpenAI/Gemini/Groq/embedding usage
 * (the actual `response.usage.input_tokens`/`output_tokens` every
 * src/lib/ai/agent-runtime.ts call already computes and, before this file
 * existed, silently discarded) against each organization's real
 * AICreditLedger.
 *
 * Credit conversion is a documented, approximate cost-weighting — 1 credit
 * = 1,000 Anthropic tokens as the baseline; other providers are weighted
 * relative to their real, typically cheaper per-token cost so a plan's
 * "1,000 AI credits/month" means roughly the same real spend regardless of
 * which provider actually served a given call. Review these weights
 * periodically against real provider pricing; they are not pulled from a
 * live pricing API.
 */
const CREDIT_COST_PER_1K_TOKENS: Record<AIUsageProvider, number> = {
  ANTHROPIC: 1.0,
  OPENAI: 0.6,
  GOOGLE_GEMINI: 0.5,
  GROQ: 0.2,
  // OpenRouter's free-tier (":free") models used by the AI runtime fallback
  // chain carry no real per-token cost, but a small nonzero weight still
  // meters usage volume against the org's credit ledger.
  OPENROUTER: 0.1,
  EMBEDDING: 0.05,
};

export function computeCreditsUsed(provider: AIUsageProvider, inputTokens: number, outputTokens: number): number {
  const totalTokens = inputTokens + outputTokens;
  const rate = CREDIT_COST_PER_1K_TOKENS[provider];
  return Math.round(((totalTokens / 1000) * rate + Number.EPSILON) * 10000) / 10000;
}

/**
 * Real, approximate blended (input+output, ~3:1 ratio) USD cost per 1,000
 * tokens for whichever provider actually served a call — the second, real-
 * money-denominated table this file needs on top of CREDIT_COST_PER_1K_TOKENS
 * above (that one prices an abstract "AI credit" unit; this one prices real
 * ₹ spend, feeding computeApiCostTokens's founder-decided cost x1.8 markup
 * x4-tokens-per-₹1 formula). Reviewed periodically against real provider
 * pricing, not pulled from a live pricing API — same discipline as
 * CREDIT_COST_PER_1K_TOKENS and token-pricing.ts's REFERENCE_COST_INR.
 */
const REAL_API_COST_USD_PER_1K_TOKENS: Record<AIUsageProvider, number> = {
  ANTHROPIC: 0.006, // Claude Sonnet-class blended $3/$15 per million input/output
  OPENAI: 0.0044, // GPT-4o-class blended $2.50/$10 per million
  GOOGLE_GEMINI: 0.00018, // Gemini Flash-class blended $0.10/$0.40 per million
  GROQ: 0.0001, // fast open-model inference, sub-$0.10/million class
  OPENROUTER: 0.00005, // free-tier (":free") fallback models — near-zero but nonzero real infra cost
  EMBEDDING: 0.00002, // embedding-class models, ~$0.02/million
};

/** Real, documented USD->INR rate used only for the metered AI-cost->Growth-Token conversion below. Review periodically against the real exchange rate; not pulled from a live FX API. */
const USD_TO_INR_RATE = 87;

/** Real ₹ cost of one AI call, for computeApiCostTokens (token-pricing.ts) to convert into the Growth Tokens debited by recordApiUsageTokenSpend below. */
export function computeRealApiCostInr(provider: AIUsageProvider, inputTokens: number, outputTokens: number): number {
  const totalTokens = inputTokens + outputTokens;
  return (totalTokens / 1000) * REAL_API_COST_USD_PER_1K_TOKENS[provider] * USD_TO_INR_RATE;
}

/** Lazily creates the ledger row the first time an org's usage is ever recorded — `monthlyCreditsGranted` seeded from the org's current Plan (0 if no plan or unlimited, since "unlimited" is checked separately via Plan.aiCreditsMonthly === null, not encoded as a magic ledger number). */
async function ensureLedger(billingAccountId: string): Promise<{ monthlyCreditsGranted: number; monthlyCreditsUsed: number; purchasedCreditsRemaining: number }> {
  const existing = await prisma.aICreditLedger.findUnique({ where: { billingAccountId } });
  if (existing) return existing;

  const account = await prisma.billingAccount.findUnique({ where: { id: billingAccountId }, include: { currentPlan: true } });
  const granted = account?.currentPlan?.aiCreditsMonthly ?? 0;
  const periodResetAt = new Date();
  periodResetAt.setMonth(periodResetAt.getMonth() + 1);

  return prisma.aICreditLedger.create({
    data: { billingAccountId, monthlyCreditsGranted: granted, monthlyCreditsUsed: 0, purchasedCreditsRemaining: 0, periodResetAt },
  });
}

/**
 * Records one real AI call's usage — never throws (fire-and-forget, same
 * discipline as notifyUser/logActivity elsewhere in this codebase, since
 * this is always called AFTER a real Claude/embedding response has already
 * returned; a metering failure must never retroactively undo or fail the
 * call it's recording). Deducts from the monthly allotment first, then
 * from any purchased top-up for the overflow — both real, persisted
 * numbers, atomically updated in one transaction.
 *
 * Phase 27: `status`/`latencyMs` are optional and additive — every existing
 * call site keeps working unchanged (status defaults to the real completed
 * call it always represented). A FAILED attempt (see fallback.ts's
 * recordProviderAttemptFailure) passes 0 tokens — nothing was actually
 * generated, so 0 real credits are ever deducted for a failure.
 */
export async function recordAIUsage(
  organizationId: string,
  provider: AIUsageProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  context?: string,
  status: AIUsageStatus = "SUCCESS",
  latencyMs?: number,
): Promise<void> {
  try {
    const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId }, select: { id: true } });
    if (!billingAccount) return; // no BillingAccount yet (shouldn't happen post-onboarding, but never block/throw on it)

    const creditsUsed = computeCreditsUsed(provider, inputTokens, outputTokens);

    await prisma.$transaction(async (tx) => {
      await tx.aIUsageEvent.create({
        data: { organizationId, billingAccountId: billingAccount.id, provider, model, inputTokens, outputTokens, creditsUsed, context, status, latencyMs },
      });

      if (creditsUsed === 0) return; // a FAILED attempt (or a genuinely free call) never touches the ledger

      const ledger = await ensureLedger(billingAccount.id);
      const remainingMonthly = Math.max(0, ledger.monthlyCreditsGranted - ledger.monthlyCreditsUsed);
      const fromMonthly = Math.min(creditsUsed, remainingMonthly);
      const fromPurchased = creditsUsed - fromMonthly;

      await tx.aICreditLedger.update({
        where: { billingAccountId: billingAccount.id },
        data: {
          monthlyCreditsUsed: { increment: fromMonthly },
          purchasedCreditsRemaining: { decrement: Math.min(fromPurchased, ledger.purchasedCreditsRemaining) },
        },
      });
    });

    if (status === "SUCCESS" && (inputTokens > 0 || outputTokens > 0)) {
      // Same real call, a second real-money debit: the AICreditLedger update
      // above just recorded this call's abstract "AI credit" usage; this
      // additionally debits the SAME Growth Token balance the topbar
      // coin/bar shows and clients buy into, at the real founder-decided
      // rate (real ₹ cost x1.8 markup x4 tokens/₹1) — never instead of the
      // AI credit debit, never blocking, since the call already happened.
      const realApiCostInr = computeRealApiCostInr(provider, inputTokens, outputTokens);
      await recordApiUsageTokenSpend(organizationId, realApiCostInr, { referenceType: "AIUsageEvent", context, provider, model });
    }
  } catch (error) {
    console.error("[billing/ai-credits] recordAIUsage failed:", error);
  }
}

export interface AICreditAvailability {
  unlimited: boolean;
  remainingCredits: number;
  monthlyCreditsGranted: number;
  monthlyCreditsUsed: number;
  purchasedCreditsRemaining: number;
}

/**
 * Real, current credit-availability snapshot for an organization — used by
 * the billing portal UI and (optionally, per-call-site) as a soft
 * pre-flight check. `unlimited: true` when the org's current Plan has
 * `aiCreditsMonthly: null` (no cap at all), which is a genuinely different
 * state from "has a very large number of credits" and must never be
 * conflated with it.
 */
export async function getAICreditAvailability(organizationId: string): Promise<AICreditAvailability> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true } });
  if (organization?.isOwnerOrg) {
    return { unlimited: true, remainingCredits: Infinity, monthlyCreditsGranted: 0, monthlyCreditsUsed: 0, purchasedCreditsRemaining: 0 };
  }

  const account = await prisma.billingAccount.findUnique({
    where: { organizationId },
    include: { currentPlan: true, aiCreditLedger: true },
  });

  if (!account) return { unlimited: false, remainingCredits: 0, monthlyCreditsGranted: 0, monthlyCreditsUsed: 0, purchasedCreditsRemaining: 0 };
  if (account.currentPlan && account.currentPlan.aiCreditsMonthly === null) {
    return { unlimited: true, remainingCredits: Infinity, monthlyCreditsGranted: 0, monthlyCreditsUsed: 0, purchasedCreditsRemaining: 0 };
  }

  const ledger = account.aiCreditLedger ?? (await ensureLedger(account.id));
  const remainingMonthly = Math.max(0, ledger.monthlyCreditsGranted - ledger.monthlyCreditsUsed);
  return {
    unlimited: false,
    remainingCredits: remainingMonthly + ledger.purchasedCreditsRemaining,
    monthlyCreditsGranted: ledger.monthlyCreditsGranted,
    monthlyCreditsUsed: ledger.monthlyCreditsUsed,
    purchasedCreditsRemaining: ledger.purchasedCreditsRemaining,
  };
}
