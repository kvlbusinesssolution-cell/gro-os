import { prisma } from "@/lib/prisma";
import type { BillingIntervalUnit, PlanTier } from "@/generated/prisma/client";

/**
 * The real, seeded platform Plan catalog — mirrors
 * src/lib/workflows/template-catalog.ts's lazy-seed pattern (a static
 * array + an idempotent `ensure*Seeded()` upsert, safe to call on every
 * pricing-page load or from a one-off `npm run db:seed` script).
 *
 * Pricing convention: every paid, self-service tier (STARTER, PROFESSIONAL,
 * BUSINESS, ENTERPRISE) gets both a MONTHLY and a YEARLY row, with the
 * yearly price set to exactly 10x the monthly price — the standard "2
 * months free" SaaS annual-billing convention. FREE and CUSTOM are each
 * seeded as a single MONTHLY row only: FREE is $0 either way (a separate
 * $0/year SKU adds nothing), and CUSTOM is a manually-negotiated,
 * never-self-service-purchased tier (see below) where "interval" is
 * whatever the operator and customer agree to off-platform — MONTHLY is
 * just the row this catalog needs to exist so `changePlan`/platform-admin
 * tooling has somewhere to point `currentPlanId` at.
 *
 * `gatewayPriceIds` is deliberately left unset (null) for every seeded plan
 * — this catalog only knows GrowthOS's own pricing/limits; the real
 * Stripe Price / Razorpay Plan / Paddle Price / LemonSqueezy Variant ids
 * that back each plan+interval only exist once a platform operator creates
 * the matching object on that gateway's own dashboard/API and fills them in
 * (via the Admin Billing Dashboard, built in a parallel task). Until then,
 * startCheckout() honestly reports "this plan isn't available via <provider>
 * yet" rather than fabricating an id.
 *
 * Storage/knowledge-base limits are stored in MB (matching Plan.storageMbLimit
 * / Plan.knowledgeBaseMbLimit) — GB/TB figures in the tier docs below are
 * converted with 1 GB = 1024 MB, 1 TB = 1024 * 1024 MB.
 *
 * MULTI-CURRENCY (Phase 20, "Light"): Plan already had a real
 * `@@unique([tier, interval, currency])` constraint from day one — the gap
 * was purely that this catalog only ever seeded USD rows. Each paid tier
 * below now carries one real, deliberately-set list price per
 * SUPPORTED_CURRENCY (admin-configured round numbers, never a live FX
 * conversion of the USD price) so an org is billed in ITS OWN currency
 * (Organization.currency) rather than always USD. There is still no live
 * exchange-rate conversion anywhere — see src/lib/billing/fx.ts's absence;
 * that's an explicit, documented non-goal of "Light" multi-currency.
 */

export const SUPPORTED_PLAN_CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "SAR", "CAD", "AUD", "SGD", "JPY"] as const;
export type SupportedPlanCurrency = (typeof SUPPORTED_PLAN_CURRENCIES)[number];

interface PlanFeatureSeed {
  key: string;
  enabled: boolean;
}

interface PlanTierSeed {
  tier: PlanTier;
  name: string;
  description: string;
  isCustom: boolean;
  /** cents, keyed by currency — real, admin-set list prices, one per SUPPORTED_PLAN_CURRENCY. CUSTOM is negotiated manually and never charged via a real checkout, so every currency is 0. */
  monthlyPriceCentsByCurrency: Record<SupportedPlanCurrency, number>;
  /** false = no YEARLY SKU seeded for this tier (FREE, CUSTOM); true = seed YEARLY at exactly 10x the monthly price in every currency (the "2 months free" convention). */
  hasYearlySku: boolean;
  trialDays: number;
  userLimit: number | null;
  workspaceLimit: number | null;
  aiCreditsMonthly: number | null;
  storageMbLimit: number | null;
  projectLimit: number | null;
  clientLimit: number | null;
  automationRunsMonthly: number | null;
  knowledgeBaseMbLimit: number | null;
  apiCallsMonthly: number | null;
  whiteLabelAccess: boolean;
  customDomainAccess: boolean;
  prioritySupport: boolean;
  ssoAccess: boolean;
  advancedAnalytics: boolean;
  features: PlanFeatureSeed[];
}

/** Every SUPPORTED_PLAN_CURRENCY set to 0 — the only plan left in the catalog is free in every currency. */
function zeroInEveryCurrency(): Record<SupportedPlanCurrency, number> {
  return Object.fromEntries(SUPPORTED_PLAN_CURRENCIES.map((c) => [c, 0])) as Record<SupportedPlanCurrency, number>;
}

// KVL Business Solutions runs no subscription tiers — a single free,
// fully-unlocked plan is the entire catalog (every limit null = unlimited,
// every feature flag on). Formerly-paid tiers (STARTER/PROFESSIONAL/
// BUSINESS/ENTERPRISE/CUSTOM) are archived by ensurePlansSeeded() below
// rather than deleted, so existing BillingAccount.currentPlanId foreign
// keys never dangle.
const PLAN_TIERS: PlanTierSeed[] = [
  {
    tier: "FREE",
    name: "Full Access",
    description: "KVL Business Solutions has no subscriptions or paid tiers — every AI agent and every feature, unlimited, free for good.",
    isCustom: false,
    monthlyPriceCentsByCurrency: zeroInEveryCurrency(),
    hasYearlySku: false,
    trialDays: 0,
    userLimit: null,
    workspaceLimit: null,
    aiCreditsMonthly: null,
    storageMbLimit: null,
    projectLimit: null,
    clientLimit: null,
    automationRunsMonthly: null,
    knowledgeBaseMbLimit: null,
    apiCallsMonthly: null,
    whiteLabelAccess: true,
    customDomainAccess: true,
    prioritySupport: true,
    ssoAccess: true,
    advancedAnalytics: true,
    features: [
      { key: "white_label", enabled: true },
      { key: "sso", enabled: true },
      { key: "analytics", enabled: true },
    ],
  },
];

export interface PlanCatalogEntry {
  tier: PlanTier;
  interval: BillingIntervalUnit;
  name: string;
  description: string;
  isCustom: boolean;
  priceCents: number;
  currency: string;
  trialDays: number;
  userLimit: number | null;
  workspaceLimit: number | null;
  aiCreditsMonthly: number | null;
  storageMbLimit: number | null;
  projectLimit: number | null;
  clientLimit: number | null;
  automationRunsMonthly: number | null;
  knowledgeBaseMbLimit: number | null;
  apiCallsMonthly: number | null;
  whiteLabelAccess: boolean;
  customDomainAccess: boolean;
  prioritySupport: boolean;
  ssoAccess: boolean;
  advancedAnalytics: boolean;
  features: PlanFeatureSeed[];
}

/** Yearly = exactly 10x the monthly price (the "2 months free" convention) — computed, never a second hand-typed table that could drift from the monthly one. */
const YEARLY_MULTIPLIER = 10;

function toEntry(tierSeed: PlanTierSeed, interval: BillingIntervalUnit, currency: SupportedPlanCurrency, priceCents: number): PlanCatalogEntry {
  return {
    tier: tierSeed.tier,
    interval,
    name: tierSeed.name,
    description: tierSeed.description,
    isCustom: tierSeed.isCustom,
    priceCents,
    currency,
    trialDays: tierSeed.trialDays,
    userLimit: tierSeed.userLimit,
    workspaceLimit: tierSeed.workspaceLimit,
    aiCreditsMonthly: tierSeed.aiCreditsMonthly,
    storageMbLimit: tierSeed.storageMbLimit,
    projectLimit: tierSeed.projectLimit,
    clientLimit: tierSeed.clientLimit,
    automationRunsMonthly: tierSeed.automationRunsMonthly,
    knowledgeBaseMbLimit: tierSeed.knowledgeBaseMbLimit,
    apiCallsMonthly: tierSeed.apiCallsMonthly,
    whiteLabelAccess: tierSeed.whiteLabelAccess,
    customDomainAccess: tierSeed.customDomainAccess,
    prioritySupport: tierSeed.prioritySupport,
    ssoAccess: tierSeed.ssoAccess,
    advancedAnalytics: tierSeed.advancedAnalytics,
    features: tierSeed.features,
  };
}

/** The full, flattened [tier, interval, currency] catalog — one entry per real Plan row this app seeds. */
export const PLAN_CATALOG: PlanCatalogEntry[] = PLAN_TIERS.flatMap((tierSeed) =>
  SUPPORTED_PLAN_CURRENCIES.flatMap((currency) => {
    const monthlyPriceCents = tierSeed.monthlyPriceCentsByCurrency[currency];
    const entries = [toEntry(tierSeed, "MONTHLY", currency, monthlyPriceCents)];
    if (tierSeed.hasYearlySku) {
      entries.push(toEntry(tierSeed, "YEARLY", currency, monthlyPriceCents * YEARLY_MULTIPLIER));
    }
    return entries;
  }),
);

/**
 * Idempotent upsert-by-[tier, interval, currency] — safe to call on every
 * pricing-page load or from `npm run db:seed`. Also upserts each plan's
 * PlanFeature rows by [planId, key] so isFeatureEnabled()'s plan-tier
 * resolution has real key-based data, not just the boolean columns on Plan
 * itself.
 */
export async function ensurePlansSeeded(): Promise<void> {
  for (const entry of PLAN_CATALOG) {
    const plan = await prisma.plan.upsert({
      where: { tier_interval_currency: { tier: entry.tier, interval: entry.interval, currency: entry.currency } },
      create: {
        tier: entry.tier,
        name: entry.name,
        description: entry.description,
        interval: entry.interval,
        priceCents: entry.priceCents,
        currency: entry.currency,
        trialDays: entry.trialDays,
        isCustom: entry.isCustom,
        userLimit: entry.userLimit,
        workspaceLimit: entry.workspaceLimit,
        aiCreditsMonthly: entry.aiCreditsMonthly,
        storageMbLimit: entry.storageMbLimit,
        projectLimit: entry.projectLimit,
        clientLimit: entry.clientLimit,
        automationRunsMonthly: entry.automationRunsMonthly,
        knowledgeBaseMbLimit: entry.knowledgeBaseMbLimit,
        apiCallsMonthly: entry.apiCallsMonthly,
        whiteLabelAccess: entry.whiteLabelAccess,
        customDomainAccess: entry.customDomainAccess,
        prioritySupport: entry.prioritySupport,
        ssoAccess: entry.ssoAccess,
        advancedAnalytics: entry.advancedAnalytics,
      },
      update: {
        name: entry.name,
        description: entry.description,
        priceCents: entry.priceCents,
        trialDays: entry.trialDays,
        isCustom: entry.isCustom,
        userLimit: entry.userLimit,
        workspaceLimit: entry.workspaceLimit,
        aiCreditsMonthly: entry.aiCreditsMonthly,
        storageMbLimit: entry.storageMbLimit,
        projectLimit: entry.projectLimit,
        clientLimit: entry.clientLimit,
        automationRunsMonthly: entry.automationRunsMonthly,
        knowledgeBaseMbLimit: entry.knowledgeBaseMbLimit,
        apiCallsMonthly: entry.apiCallsMonthly,
        whiteLabelAccess: entry.whiteLabelAccess,
        customDomainAccess: entry.customDomainAccess,
        prioritySupport: entry.prioritySupport,
        ssoAccess: entry.ssoAccess,
        advancedAnalytics: entry.advancedAnalytics,
      },
    });

    for (const feature of entry.features) {
      await prisma.planFeature.upsert({
        where: { planId_key: { planId: plan.id, key: feature.key } },
        create: { planId: plan.id, key: feature.key, enabled: feature.enabled },
        update: { enabled: feature.enabled },
      });
    }
  }

  // Archive (never delete — BillingAccount.currentPlanId still references
  // these rows for any org that switched plans before the paid tiers were
  // removed) any previously-seeded tier that's no longer in PLAN_TIERS, so
  // the ACTIVE-only plan queries (e.g. the subscription page) only ever
  // list the one free plan.
  const currentTiers = PLAN_TIERS.map((t) => t.tier);
  await prisma.plan.updateMany({
    where: { status: "ACTIVE", tier: { notIn: currentTiers } },
    data: { status: "ARCHIVED" },
  });
}
