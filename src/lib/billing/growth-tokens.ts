import { prisma } from "@/lib/prisma";
import { Prisma, type AIUsageProvider } from "@/generated/prisma/client";
import { GROWTH_TOKEN_COST, computeApiCostTokens, type GrowthTokenActionKey } from "./token-pricing";

/**
 * Growth Token ledger — gates the Business Listings (JustDial-style)
 * feature. Structurally mirrors src/lib/billing/ai-credits.ts (same
 * ensureLedger/availability shape, same owner-org-unlimited semantics,
 * same monthly-then-purchased deduction order) but with one real
 * difference: AI credits are recorded fire-and-forget AFTER an AI call has
 * already happened and can never undo it, so recordAIUsage never blocks
 * anything. A Growth Token spend gates a real mutation (publishing a
 * listing/deal) that hasn't happened yet — spendGrowthTokens below must be
 * able to say no, atomically, before that mutation proceeds.
 *
 * Token prices come from src/lib/billing/token-pricing.ts's GROWTH_TOKEN_COST
 * (re-exported here for server-side callers that already import from this
 * file) — see that file for the 4x-markup, free-tier-floor pricing rule,
 * and for why "use client" components must import GROWTH_TOKEN_COST
 * directly from token-pricing.ts instead of from here.
 */

export { GROWTH_TOKEN_COST };

// Founder promo (2026-09): every brand-new signup gets a real, one-time
// 300-token welcome gift — see grantSignupBonusTokens below, called once
// from createOrContinueOrganization (src/app/onboarding/actions.ts) right
// after that org's first-ever BillingAccount is created. Deliberately NOT
// baked into ensureLedger's own creation defaults — ensureLedger is a
// generic lazy-create used by spend/refund/purchase flows too, any of
// which could otherwise re-trigger a "signup" bonus for an org whose
// ledger simply didn't exist yet for unrelated reasons.
export const SIGNUP_BONUS_TOKENS = 300;

/** Grants the one-time signup welcome bonus onto a real (already-created) ledger row for `billingAccountId`. Never called more than once per org — callers are responsible for only invoking this at real signup time. Writes a SIGNUP_BONUS GrowthTokenUsageEvent (tokensUsed negative — a credit) so the Admin Growth Token Management page has a real audit trail for it, same as every other ledger movement. */
export async function grantSignupBonusTokens(billingAccountId: string, organizationId: string): Promise<void> {
  await ensureLedger(billingAccountId);
  await prisma.$transaction([
    prisma.growthTokenLedger.update({
      where: { billingAccountId },
      data: { purchasedTokensRemaining: { increment: SIGNUP_BONUS_TOKENS } },
    }),
    prisma.growthTokenUsageEvent.create({
      data: {
        organizationId,
        billingAccountId,
        action: "SIGNUP_BONUS",
        tokensUsed: -SIGNUP_BONUS_TOKENS,
        context: "Welcome signup bonus",
        status: "SUCCESS",
      },
    }),
  ]);
}

interface LedgerSnapshot {
  monthlyTokensGranted: number;
  monthlyTokensUsed: number;
  purchasedTokensRemaining: number;
  periodResetAt: Date | null;
}

/** Find-or-create the ledger row, seeding monthlyTokensGranted from the org's current Plan (0 if no plan or unlimited — "unlimited" is checked separately via Plan.growthTokensMonthly === null, never a magic ledger number). Accepts an optional transaction client so spendGrowthTokens can compose this inside its own atomic check-and-deduct. Exported for token-purchase.ts, which needs a real ledger row to exist before crediting a purchase to it. */
export async function ensureLedger(billingAccountId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<LedgerSnapshot> {
  const existing = await client.growthTokenLedger.findUnique({ where: { billingAccountId } });
  if (existing) return existing;

  const account = await client.billingAccount.findUnique({ where: { id: billingAccountId }, include: { currentPlan: true } });
  const granted = resolveMonthlyGrant(account?.currentPlan?.growthTokensMonthly);
  const periodResetAt = nextMonthlyReset();

  try {
    return await client.growthTokenLedger.create({
      data: { billingAccountId, monthlyTokensGranted: granted, monthlyTokensUsed: 0, purchasedTokensRemaining: 0, periodResetAt },
    });
  } catch (error) {
    // Two concurrent first-ever spends for the same org can both reach here
    // and race to create the row — the loser hits the unique constraint on
    // billingAccountId, not a real failure, so fall back to reading the
    // winner's row instead of surfacing a spurious error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const created = await client.growthTokenLedger.findUnique({ where: { billingAccountId } });
      if (created) return created;
    }
    throw error;
  }
}

function resolveMonthlyGrant(growthTokensMonthly: number | null | undefined): number {
  return growthTokensMonthly ?? 0;
}

function nextMonthlyReset(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + 1);
  return next;
}

/**
 * Rolls a ledger's monthly allowance over once its period has elapsed —
 * resets monthlyTokensUsed to 0, re-syncs monthlyTokensGranted to whatever
 * the org's current Plan grants NOW (so a mid-cycle plan upgrade/downgrade
 * takes effect on the next reset), and pushes periodResetAt one month
 * forward. Mirrors ai-credits.ts's monthly reset job, which
 * recurring-billing-queue.ts already dispatches on a schedule — this ledger
 * previously had no equivalent, so monthlyTokensUsed only ever grew and an
 * org that exhausted its monthly allotment stayed blocked every month after
 * with no way back in short of buying purchased tokens. Never resets
 * purchasedTokensRemaining — bought tokens don't expire on a monthly cycle.
 * Safe to call opportunistically (e.g. from getGrowthTokenAvailability and
 * spendGrowthTokens) since it only ever activates once periodResetAt has
 * actually passed.
 */
async function resetLedgerIfDue(billingAccountId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<LedgerSnapshot> {
  const ledger = await ensureLedger(billingAccountId, client);
  if (!ledger.periodResetAt || ledger.periodResetAt.getTime() > Date.now()) return ledger;

  const account = await client.billingAccount.findUnique({ where: { id: billingAccountId }, include: { currentPlan: true } });
  const granted = resolveMonthlyGrant(account?.currentPlan?.growthTokensMonthly);

  return client.growthTokenLedger.update({
    where: { billingAccountId },
    data: { monthlyTokensGranted: granted, monthlyTokensUsed: 0, periodResetAt: nextMonthlyReset() },
  });
}

export interface GrowthTokenAvailability {
  unlimited: boolean;
  remainingTokens: number;
  monthlyTokensGranted: number;
  monthlyTokensUsed: number;
  purchasedTokensRemaining: number;
}

/** Real, current Growth Token balance for an organization — read-only, side-effect-free, safe to call from a Server Component to render a balance badge. */
export async function getGrowthTokenAvailability(organizationId: string): Promise<GrowthTokenAvailability> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true } });
  if (organization?.isOwnerOrg) {
    return { unlimited: true, remainingTokens: Infinity, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 0 };
  }

  const account = await prisma.billingAccount.findUnique({
    where: { organizationId },
    include: { currentPlan: true, growthTokenLedger: true },
  });

  if (!account) return { unlimited: false, remainingTokens: 0, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 0 };
  if (account.currentPlan && account.currentPlan.growthTokensMonthly === null) {
    return { unlimited: true, remainingTokens: Infinity, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 0 };
  }

  const ledger = await resetLedgerIfDue(account.id);
  const remainingMonthly = Math.max(0, ledger.monthlyTokensGranted - ledger.monthlyTokensUsed);
  return {
    unlimited: false,
    remainingTokens: remainingMonthly + ledger.purchasedTokensRemaining,
    monthlyTokensGranted: ledger.monthlyTokensGranted,
    monthlyTokensUsed: ledger.monthlyTokensUsed,
    purchasedTokensRemaining: ledger.purchasedTokensRemaining,
  };
}

export interface SpendGrowthTokensResult {
  ok: boolean;
  error?: string;
  remainingTokens?: number;
}

export interface SpendGrowthTokensOptions {
  referenceType?: string;
  referenceId?: string;
  context?: string;
  /** Run inside the caller's own transaction (e.g. so a listing's status flip to PUBLISHED only commits alongside a successful spend) instead of opening a new one. */
  tx?: Prisma.TransactionClient;
}

/**
 * Attempts to spend Growth Tokens for a gated action. Unlike recordAIUsage,
 * this genuinely gates a mutation that hasn't happened yet:
 * - Missing organization/billing account -> explicit {ok:false}, never a
 *   silent no-op — a caller MUST see this and refuse to proceed.
 * - Owner org -> always {ok:true, remainingTokens: Infinity}. Still writes
 *   a SUCCESS usage event for audit/analytics parity, but skips the
 *   balance check/deduction entirely — necessary, not optional, since the
 *   owner org's nominal ledger (seeded from whatever Plan it happens to
 *   have) could otherwise get exhausted and incorrectly BLOCK it.
 * - Otherwise: re-checks the real balance INSIDE a transaction (not just a
 *   pre-check) so two concurrent spends against a balance that can only
 *   cover one of them can never both succeed. Insufficient balance writes a
 *   BLOCKED usage event and returns {ok:false} without deducting anything.
 * A thrown DB error propagates as {ok:false} — never silently let a free
 * action through.
 */
export async function spendGrowthTokens(organizationId: string, action: GrowthTokenActionKey, opts: SpendGrowthTokensOptions = {}): Promise<SpendGrowthTokensResult> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true } });
  if (!organization) return { ok: false, error: "Organization not found." };

  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId }, include: { currentPlan: true } });
  if (!billingAccount) return { ok: false, error: "No billing account found for this organization." };

  const cost = GROWTH_TOKEN_COST[action];

  // Owner org, or a plan with growthTokensMonthly: null ("unlimited", not a
  // magic ledger number) — both bypass the balance check/deduction
  // entirely. Necessary, not optional: ensureLedger's `?? 0` fallback would
  // otherwise treat a null (unlimited) allotment as a granted amount of 0
  // and incorrectly BLOCK an org that's supposed to never be blocked.
  if (organization.isOwnerOrg || (billingAccount.currentPlan && billingAccount.currentPlan.growthTokensMonthly === null)) {
    try {
      const client = opts.tx ?? prisma;
      await client.growthTokenUsageEvent.create({
        data: {
          organizationId,
          billingAccountId: billingAccount.id,
          action,
          referenceType: opts.referenceType,
          referenceId: opts.referenceId,
          tokensUsed: cost,
          context: opts.context,
          status: "SUCCESS",
        },
      });
    } catch (error) {
      console.error("[billing/growth-tokens] unlimited-bypass audit write failed:", error);
    }
    return { ok: true, remainingTokens: Infinity };
  }

  const run = async (tx: Prisma.TransactionClient): Promise<SpendGrowthTokensResult> => {
    await resetLedgerIfDue(billingAccount.id, tx);

    // Lock the ledger row for the rest of this transaction BEFORE deciding
    // anything. A plain SELECT (the previous approach) never locks the row,
    // so two concurrent spends against a balance that can only cover one of
    // them could both read the same pre-deduction balance, both pass the
    // "enough tokens" check, and both commit an increment — overdrawing the
    // ledger even though the increments themselves don't corrupt each
    // other. SELECT ... FOR UPDATE blocks a concurrent spend's own lock
    // attempt until this transaction commits or rolls back, so the second
    // spend in a race always re-reads the real post-deduction balance.
    const [locked] = await tx.$queryRaw<Array<{ monthlyTokensGranted: number; monthlyTokensUsed: number; purchasedTokensRemaining: number }>>`
      SELECT "monthlyTokensGranted", "monthlyTokensUsed", "purchasedTokensRemaining"
      FROM "GrowthTokenLedger"
      WHERE "billingAccountId" = ${billingAccount.id}
      FOR UPDATE
    `;
    const remainingMonthly = Math.max(0, locked.monthlyTokensGranted - locked.monthlyTokensUsed);
    const remainingTokens = remainingMonthly + locked.purchasedTokensRemaining;

    if (remainingTokens < cost) {
      await tx.growthTokenUsageEvent.create({
        data: {
          organizationId,
          billingAccountId: billingAccount.id,
          action,
          referenceType: opts.referenceType,
          referenceId: opts.referenceId,
          tokensUsed: cost,
          context: opts.context,
          status: "BLOCKED",
        },
      });
      return { ok: false, error: `Not enough Growth Tokens for this action — needs ${cost}, ${remainingTokens} remaining.`, remainingTokens };
    }

    const fromMonthly = Math.min(cost, remainingMonthly);
    const fromPurchased = cost - fromMonthly;

    await tx.growthTokenLedger.update({
      where: { billingAccountId: billingAccount.id },
      data: {
        monthlyTokensUsed: { increment: fromMonthly },
        purchasedTokensRemaining: { decrement: Math.min(fromPurchased, locked.purchasedTokensRemaining) },
      },
    });
    await tx.growthTokenUsageEvent.create({
      data: {
        organizationId,
        billingAccountId: billingAccount.id,
        action,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        tokensUsed: cost,
        context: opts.context,
        status: "SUCCESS",
      },
    });

    return { ok: true, remainingTokens: remainingTokens - cost };
  };

  try {
    return opts.tx ? await run(opts.tx) : await prisma.$transaction(run);
  } catch (error) {
    console.error("[billing/growth-tokens] spendGrowthTokens failed:", error);
    return { ok: false, error: "Could not process Growth Token spend — please try again." };
  }
}

export interface RecordApiUsageTokenSpendOptions {
  referenceType?: string;
  referenceId?: string;
  context?: string;
  provider?: AIUsageProvider;
  model?: string;
}

/**
 * Debits the Growth Token ledger for one real, already-completed AI call's
 * real ₹ cost (converted via computeApiCostTokens, token-pricing.ts) —
 * called from recordAIUsage (ai-credits.ts) after every real AI response.
 *
 * Deliberately NOT spendGrowthTokens: that function GATES a mutation that
 * hasn't happened yet and must be able to say no atomically. This call
 * happened already (the AI response already returned) — it can never say no
 * or undo anything, so it mirrors recordAIUsage's own non-blocking,
 * best-effort discipline instead: deduct what the balance can cover (never
 * below 0), record the real intended cost either way, never throw past this
 * function.
 */
export async function recordApiUsageTokenSpend(organizationId: string, realApiCostInr: number, opts: RecordApiUsageTokenSpendOptions = {}): Promise<void> {
  if (!(realApiCostInr > 0)) return; // a genuinely free/zero-cost call never touches the ledger

  const cost = computeApiCostTokens(realApiCostInr);
  const context = opts.context ?? (opts.provider && opts.model ? `${opts.provider}:${opts.model}` : opts.provider);

  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true } });
    if (!organization) return;

    const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId }, include: { currentPlan: true } });
    if (!billingAccount) return;

    // Owner org, or a plan with growthTokensMonthly: null ("unlimited") —
    // both bypass deduction entirely, same posture as spendGrowthTokens's
    // own unlimited bypass. Still writes a SUCCESS audit event for
    // analytics parity with every other Growth Token action.
    if (organization.isOwnerOrg || (billingAccount.currentPlan && billingAccount.currentPlan.growthTokensMonthly === null)) {
      await prisma.growthTokenUsageEvent.create({
        data: {
          organizationId,
          billingAccountId: billingAccount.id,
          action: "AI_API_USAGE",
          referenceType: opts.referenceType,
          referenceId: opts.referenceId,
          tokensUsed: cost,
          context,
          status: "SUCCESS",
        },
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await resetLedgerIfDue(billingAccount.id, tx);

      const [locked] = await tx.$queryRaw<Array<{ monthlyTokensGranted: number; monthlyTokensUsed: number; purchasedTokensRemaining: number }>>`
        SELECT "monthlyTokensGranted", "monthlyTokensUsed", "purchasedTokensRemaining"
        FROM "GrowthTokenLedger"
        WHERE "billingAccountId" = ${billingAccount.id}
        FOR UPDATE
      `;
      const remainingMonthly = Math.max(0, locked.monthlyTokensGranted - locked.monthlyTokensUsed);
      const fromMonthly = Math.min(cost, remainingMonthly);
      const fromPurchased = Math.min(cost - fromMonthly, locked.purchasedTokensRemaining);

      await tx.growthTokenLedger.update({
        where: { billingAccountId: billingAccount.id },
        data: {
          monthlyTokensUsed: { increment: fromMonthly },
          purchasedTokensRemaining: { decrement: fromPurchased },
        },
      });
      await tx.growthTokenUsageEvent.create({
        data: {
          organizationId,
          billingAccountId: billingAccount.id,
          action: "AI_API_USAGE",
          referenceType: opts.referenceType,
          referenceId: opts.referenceId,
          tokensUsed: cost,
          context,
          status: "SUCCESS",
        },
      });
    });
  } catch (error) {
    console.error("[billing/growth-tokens] recordApiUsageTokenSpend failed:", error);
  }
}

export interface AdjustGrowthTokensResult {
  ok: boolean;
  error?: string;
  remainingTokens?: number;
}

/**
 * Platform-owner-initiated Growth Token balance correction — the only way
 * to move an org's balance outside a real spend/purchase/signup-bonus flow.
 * Used by the Admin Growth Token Management page
 * (src/app/admin/growth-tokens) for cases like "compensate a client for a
 * billing error" (grant) or "claw back tokens after a disputed/fraudulent
 * purchase refund" (deduct).
 *
 * `deltaTokens` is signed: positive credits purchasedTokensRemaining
 * (never expires, same bucket as a real purchase or the signup bonus),
 * negative deducts from it — clamped at 0, never below, since an admin
 * correction must never corrupt the ledger into an invalid negative state.
 * Deliberately only ever touches purchasedTokensRemaining, never
 * monthlyTokensGranted/monthlyTokensUsed — those two fields represent the
 * org's actual Plan entitlement and must stay derived solely from
 * resetLedgerIfDue, never hand-edited.
 */
export async function adjustGrowthTokensManually(
  organizationId: string,
  deltaTokens: number,
  opts: { adminUserId: string; reason: string },
): Promise<AdjustGrowthTokensResult> {
  if (!Number.isFinite(deltaTokens) || deltaTokens === 0) return { ok: false, error: "Enter a nonzero amount to grant or deduct." };
  if (!opts.reason.trim()) return { ok: false, error: "A reason is required for every manual token adjustment." };

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true } });
  if (!organization) return { ok: false, error: "Organization not found." };
  if (organization.isOwnerOrg) return { ok: false, error: "The owner organization is always unlimited — there is no balance to adjust." };

  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId } });
  if (!billingAccount) return { ok: false, error: "No billing account found for this organization." };

  try {
    return await prisma.$transaction(async (tx) => {
      await resetLedgerIfDue(billingAccount.id, tx);

      const [locked] = await tx.$queryRaw<Array<{ purchasedTokensRemaining: number }>>`
        SELECT "purchasedTokensRemaining"
        FROM "GrowthTokenLedger"
        WHERE "billingAccountId" = ${billingAccount.id}
        FOR UPDATE
      `;

      const delta = deltaTokens > 0 ? deltaTokens : -Math.min(-deltaTokens, locked.purchasedTokensRemaining);

      const updated = await tx.growthTokenLedger.update({
        where: { billingAccountId: billingAccount.id },
        data: { purchasedTokensRemaining: { increment: delta } },
      });
      await tx.growthTokenUsageEvent.create({
        data: {
          organizationId,
          billingAccountId: billingAccount.id,
          action: "MANUAL_ADJUSTMENT",
          referenceType: "AdminManualAdjustment",
          referenceId: opts.adminUserId,
          tokensUsed: -delta, // credit (positive delta) recorded negative, deduction (negative delta) recorded positive — same sign convention as every other event
          context: opts.reason,
          status: "SUCCESS",
        },
      });

      const remainingMonthly = Math.max(0, updated.monthlyTokensGranted - updated.monthlyTokensUsed);
      return { ok: true, remainingTokens: remainingMonthly + updated.purchasedTokensRemaining };
    });
  } catch (error) {
    console.error("[billing/growth-tokens] adjustGrowthTokensManually failed:", error);
    return { ok: false, error: "Could not process this adjustment — please try again." };
  }
}
