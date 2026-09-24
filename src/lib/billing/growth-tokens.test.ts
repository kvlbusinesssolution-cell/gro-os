import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeApiCostTokens } from "./token-pricing";
import {
  GROWTH_TOKEN_COST,
  SIGNUP_BONUS_TOKENS,
  adjustGrowthTokensManually,
  getGrowthTokenAvailability,
  grantSignupBonusTokens,
  recordApiUsageTokenSpend,
  spendGrowthTokens,
} from "./growth-tokens";

/**
 * Real Postgres integration test for the Growth Token ledger — proves the
 * owner-org bypass, real exhaustion -> BLOCKED, an unlimited plan, and (the
 * one that actually matters) that the balance re-check happens INSIDE the
 * transaction, not just as a pre-check, so two concurrent spends against a
 * balance that can only cover one of them can never both succeed.
 */
describe("growth-tokens.ts — real Growth Token ledger", () => {
  const suffix = Date.now();
  let ownerOrgId: string;
  let limitedOrgId: string;
  let unlimitedOrgId: string;
  let limitedPlanId: string;
  let unlimitedPlanId: string;

  beforeAll(async () => {
    const limitedPlan = await prisma.plan.create({
      data: { tier: "CUSTOM", interval: "MONTHLY", currency: `TEST${suffix}A`, name: "Test Limited", priceCents: 0, growthTokensMonthly: GROWTH_TOKEN_COST.DEAL_POST },
    });
    limitedPlanId = limitedPlan.id;

    const unlimitedPlan = await prisma.plan.create({
      data: { tier: "CUSTOM", interval: "MONTHLY", currency: `TEST${suffix}B`, name: "Test Unlimited", priceCents: 0, growthTokensMonthly: null },
    });
    unlimitedPlanId = unlimitedPlan.id;

    const ownerOrg = await prisma.organization.create({ data: { name: "Growth Token Owner Org", slug: `gt-owner-${suffix}`, isOwnerOrg: true } });
    ownerOrgId = ownerOrg.id;
    await prisma.billingAccount.create({ data: { organizationId: ownerOrgId } });

    const limitedOrg = await prisma.organization.create({ data: { name: "Growth Token Limited Org", slug: `gt-limited-${suffix}` } });
    limitedOrgId = limitedOrg.id;
    await prisma.billingAccount.create({ data: { organizationId: limitedOrgId, currentPlanId: limitedPlanId } });

    const unlimitedOrg = await prisma.organization.create({ data: { name: "Growth Token Unlimited Org", slug: `gt-unlimited-${suffix}` } });
    unlimitedOrgId = unlimitedOrg.id;
    await prisma.billingAccount.create({ data: { organizationId: unlimitedOrgId, currentPlanId: unlimitedPlanId } });
  });

  afterAll(async () => {
    for (const organizationId of [ownerOrgId, limitedOrgId, unlimitedOrgId]) {
      await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId } });
      await prisma.growthTokenLedger.deleteMany({ where: { billingAccount: { organizationId } } });
      await prisma.billingAccount.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.plan.deleteMany({ where: { id: { in: [limitedPlanId, unlimitedPlanId] } } });
  });

  it("owner org: always unlimited, always succeeds even after repeated spends", async () => {
    const availability = await getGrowthTokenAvailability(ownerOrgId);
    expect(availability).toEqual({ unlimited: true, remainingTokens: Infinity, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 0 });

    for (let i = 0; i < 3; i++) {
      const result = await spendGrowthTokens(ownerOrgId, "LISTING_PUBLISH", { referenceType: "test" });
      expect(result).toEqual({ ok: true, remainingTokens: Infinity });
    }
  });

  it("non-owner org with a limited plan: spends down to exactly 0, then the next spend is BLOCKED with an event recorded", async () => {
    const cost = GROWTH_TOKEN_COST.DEAL_POST;
    const before = await getGrowthTokenAvailability(limitedOrgId);
    expect(before).toMatchObject({ unlimited: false, remainingTokens: cost });

    const first = await spendGrowthTokens(limitedOrgId, "DEAL_POST", { referenceType: "test" });
    expect(first.ok).toBe(true);
    expect(first.remainingTokens).toBe(0);

    const after = await getGrowthTokenAvailability(limitedOrgId);
    expect(after.remainingTokens).toBe(0);

    const blocked = await spendGrowthTokens(limitedOrgId, "DEAL_POST", { referenceType: "test" });
    expect(blocked.ok).toBe(false);
    expect(blocked.remainingTokens).toBe(0);

    const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: limitedOrgId, action: "DEAL_POST" }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(events[0].status).toBe("SUCCESS");
    expect(events[1].status).toBe("BLOCKED");
  });

  it("plan with growthTokensMonthly: null reports unlimited", async () => {
    const availability = await getGrowthTokenAvailability(unlimitedOrgId);
    expect(availability.unlimited).toBe(true);
    expect(availability.remainingTokens).toBe(Infinity);

    const result = await spendGrowthTokens(unlimitedOrgId, "LISTING_PUBLISH", { referenceType: "test" });
    expect(result).toEqual({ ok: true, remainingTokens: Infinity });
  });

  it("concurrent race: two parallel spends against a balance covering exactly one succeed exactly once", async () => {
    const raceOrg = await prisma.organization.create({ data: { name: "Growth Token Race Org", slug: `gt-race-${suffix}` } });
    const racePlan = await prisma.plan.create({
      data: { tier: "CUSTOM", interval: "MONTHLY", currency: `TEST${suffix}C`, name: "Test Race", priceCents: 0, growthTokensMonthly: GROWTH_TOKEN_COST.DEAL_POST },
    });
    await prisma.billingAccount.create({ data: { organizationId: raceOrg.id, currentPlanId: racePlan.id } });

    try {
      const [a, b] = await Promise.all([
        spendGrowthTokens(raceOrg.id, "DEAL_POST", { referenceType: "race" }),
        spendGrowthTokens(raceOrg.id, "DEAL_POST", { referenceType: "race" }),
      ]);

      const results = [a, b];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toHaveLength(1);

      const finalAvailability = await getGrowthTokenAvailability(raceOrg.id);
      expect(finalAvailability.remainingTokens).toBe(0);
    } finally {
      await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: raceOrg.id } });
      await prisma.growthTokenLedger.deleteMany({ where: { billingAccount: { organizationId: raceOrg.id } } });
      await prisma.billingAccount.deleteMany({ where: { organizationId: raceOrg.id } });
      await prisma.organization.delete({ where: { id: raceOrg.id } });
      await prisma.plan.delete({ where: { id: racePlan.id } });
    }
  });

  it("grantSignupBonusTokens: credits a real, one-time 300-token welcome gift onto purchasedTokensRemaining (never expires with the monthly reset)", async () => {
    const signupOrg = await prisma.organization.create({ data: { name: "Growth Token Signup Bonus Org", slug: `gt-signup-${suffix}` } });
    const billingAccount = await prisma.billingAccount.create({ data: { organizationId: signupOrg.id } });

    try {
      await grantSignupBonusTokens(billingAccount.id, signupOrg.id);

      const availability = await getGrowthTokenAvailability(signupOrg.id);
      expect(availability.purchasedTokensRemaining).toBe(SIGNUP_BONUS_TOKENS);
      expect(availability.remainingTokens).toBe(SIGNUP_BONUS_TOKENS);

      const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: signupOrg.id, action: "SIGNUP_BONUS" } });
      expect(events).toHaveLength(1);
      expect(events[0].tokensUsed).toBe(-SIGNUP_BONUS_TOKENS); // a credit, recorded negative
    } finally {
      await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: signupOrg.id } });
      await prisma.growthTokenLedger.deleteMany({ where: { billingAccountId: billingAccount.id } });
      await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
      await prisma.organization.delete({ where: { id: signupOrg.id } });
    }
  });

  describe("recordApiUsageTokenSpend — real metered AI cost debits the same Growth Token balance", () => {
    it("debits computeApiCostTokens(realApiCostInr) tokens and records an AI_API_USAGE SUCCESS event", async () => {
      const org = await prisma.organization.create({ data: { name: "Growth Token API Usage Org", slug: `gt-api-${suffix}` } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });

      try {
        await prisma.growthTokenLedger.create({
          data: { billingAccountId: billingAccount.id, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 100_000 },
        });
        const cost = computeApiCostTokens(100); // 720 tokens, the founder's own worked example

        await recordApiUsageTokenSpend(org.id, 100, { provider: "ANTHROPIC", model: "claude-sonnet-5" });

        const availability = await getGrowthTokenAvailability(org.id);
        expect(availability.purchasedTokensRemaining).toBe(100_000 - cost);

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "AI_API_USAGE" } });
        expect(events).toHaveLength(1);
        expect(events[0].tokensUsed).toBe(cost);
        expect(events[0].status).toBe("SUCCESS");
        expect(events[0].context).toBe("ANTHROPIC:claude-sonnet-5");
      } finally {
        await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: org.id } });
        await prisma.growthTokenLedger.deleteMany({ where: { billingAccountId: billingAccount.id } });
        await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });

    it("never blocks and never goes negative: a balance too small to cover the real cost is clamped to 0, not refused", async () => {
      const org = await prisma.organization.create({ data: { name: "Growth Token API Usage Shortfall Org", slug: `gt-api-short-${suffix}` } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });

      try {
        await prisma.growthTokenLedger.create({
          data: { billingAccountId: billingAccount.id, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining: 5 },
        });

        await recordApiUsageTokenSpend(org.id, 100, { provider: "ANTHROPIC", model: "claude-sonnet-5" }); // real cost is 720 tokens, balance is only 5

        const availability = await getGrowthTokenAvailability(org.id);
        expect(availability.purchasedTokensRemaining).toBe(0);

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "AI_API_USAGE" } });
        expect(events).toHaveLength(1);
        expect(events[0].status).toBe("SUCCESS"); // already happened — never BLOCKED like a gated spend would be
      } finally {
        await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: org.id } });
        await prisma.growthTokenLedger.deleteMany({ where: { billingAccountId: billingAccount.id } });
        await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });

    it("owner org: bypasses deduction entirely but still records a SUCCESS audit event", async () => {
      const org = await prisma.organization.create({ data: { name: "Growth Token API Usage Owner Org", slug: `gt-api-owner-${suffix}`, isOwnerOrg: true } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });

      try {
        await recordApiUsageTokenSpend(org.id, 100, { provider: "ANTHROPIC", model: "claude-sonnet-5" });

        const ledger = await prisma.growthTokenLedger.findUnique({ where: { billingAccountId: billingAccount.id } });
        expect(ledger).toBeNull(); // never even created — owner org never touches the ledger

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "AI_API_USAGE" } });
        expect(events).toHaveLength(1);
        expect(events[0].status).toBe("SUCCESS");
      } finally {
        await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: org.id } });
        await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });

    it("a genuinely zero real cost never touches the ledger or writes an event", async () => {
      const org = await prisma.organization.create({ data: { name: "Growth Token API Usage Zero Org", slug: `gt-api-zero-${suffix}` } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });

      try {
        await recordApiUsageTokenSpend(org.id, 0, { provider: "ANTHROPIC", model: "claude-sonnet-5" });

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "AI_API_USAGE" } });
        expect(events).toHaveLength(0);
      } finally {
        await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });
  });

  describe("adjustGrowthTokensManually — Admin Growth Token Management page's manual grant/deduct", () => {
    async function makeOrgWithLedger(label: string, purchasedTokensRemaining: number) {
      const org = await prisma.organization.create({ data: { name: `Growth Token Adjust ${label} Org`, slug: `gt-adjust-${label}-${suffix}` } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });
      await prisma.growthTokenLedger.create({
        data: { billingAccountId: billingAccount.id, monthlyTokensGranted: 0, monthlyTokensUsed: 0, purchasedTokensRemaining },
      });
      return { org, billingAccount };
    }

    async function cleanup(orgId: string, billingAccountId: string) {
      await prisma.growthTokenUsageEvent.deleteMany({ where: { organizationId: orgId } });
      await prisma.growthTokenLedger.deleteMany({ where: { billingAccountId } });
      await prisma.billingAccount.delete({ where: { id: billingAccountId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }

    it("a positive delta grants tokens and records a negative (credit) event", async () => {
      const { org, billingAccount } = await makeOrgWithLedger("grant", 100);
      try {
        const result = await adjustGrowthTokensManually(org.id, 500, { adminUserId: "admin-1", reason: "Goodwill credit for a billing error" });
        expect(result).toEqual({ ok: true, remainingTokens: 600 });

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "MANUAL_ADJUSTMENT" } });
        expect(events).toHaveLength(1);
        expect(events[0].tokensUsed).toBe(-500);
        expect(events[0].context).toBe("Goodwill credit for a billing error");
      } finally {
        await cleanup(org.id, billingAccount.id);
      }
    });

    it("a negative delta deducts tokens and records a positive (debit) event", async () => {
      const { org, billingAccount } = await makeOrgWithLedger("deduct", 500);
      try {
        const result = await adjustGrowthTokensManually(org.id, -200, { adminUserId: "admin-1", reason: "Clawback after a disputed refund" });
        expect(result).toEqual({ ok: true, remainingTokens: 300 });

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "MANUAL_ADJUSTMENT" } });
        expect(events[0].tokensUsed).toBe(200);
      } finally {
        await cleanup(org.id, billingAccount.id);
      }
    });

    it("a deduction larger than the balance clamps at 0, never goes negative", async () => {
      const { org, billingAccount } = await makeOrgWithLedger("overdeduct", 50);
      try {
        const result = await adjustGrowthTokensManually(org.id, -500, { adminUserId: "admin-1", reason: "Clawback" });
        expect(result).toEqual({ ok: true, remainingTokens: 0 });
      } finally {
        await cleanup(org.id, billingAccount.id);
      }
    });

    it("rejects a zero delta and a blank reason without writing anything", async () => {
      const { org, billingAccount } = await makeOrgWithLedger("reject", 100);
      try {
        const zero = await adjustGrowthTokensManually(org.id, 0, { adminUserId: "admin-1", reason: "test" });
        expect(zero.ok).toBe(false);

        const blank = await adjustGrowthTokensManually(org.id, 100, { adminUserId: "admin-1", reason: "   " });
        expect(blank.ok).toBe(false);

        const events = await prisma.growthTokenUsageEvent.findMany({ where: { organizationId: org.id, action: "MANUAL_ADJUSTMENT" } });
        expect(events).toHaveLength(0);
      } finally {
        await cleanup(org.id, billingAccount.id);
      }
    });

    it("rejects adjusting the owner organization — it has no balance to adjust", async () => {
      const org = await prisma.organization.create({ data: { name: "Growth Token Adjust Owner Org", slug: `gt-adjust-owner-${suffix}`, isOwnerOrg: true } });
      const billingAccount = await prisma.billingAccount.create({ data: { organizationId: org.id } });
      try {
        const result = await adjustGrowthTokensManually(org.id, 100, { adminUserId: "admin-1", reason: "test" });
        expect(result.ok).toBe(false);
      } finally {
        await prisma.billingAccount.delete({ where: { id: billingAccount.id } });
        await prisma.organization.delete({ where: { id: org.id } });
      }
    });
  });
});
