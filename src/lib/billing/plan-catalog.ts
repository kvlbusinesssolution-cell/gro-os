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
 * `@@unique([tier, interval, currency])` constraint from day one. Each
 * paid tier below carries one real list price per SUPPORTED_PLAN_CURRENCY
 * — the USD price is the deliberately-set number (see the tier docs
 * below); every other currency is `usdCentsToRoundedCurrency()`'s
 * approximate, ROUNDED conversion of that same USD price (documented
 * placeholder rates, not a live FX feed) so an org is billed in ITS OWN
 * currency (Organization.currency) rather than always USD from day one.
 * A platform operator can hand-edit any of these to a real, deliberately
 * chosen local price at any time — nothing here is treated as a live
 * exchange-rate conversion; see src/lib/billing/exchange-rates.ts's own
 * "display-only, never feeds a real charge amount" doc for the actual
 * live-rate path (used only for an informational "≈" aside, never this
 * catalog).
 *
 * OWNER-ORG EXEMPTION: KVL Business Solutions' own tenant organization
 * (Organization.isOwnerOrg = true) is never subject to any tier here —
 * checkPlanLimit (src/lib/billing/usage-metering.ts) short-circuits to
 * unlimited for that one org before it ever looks at a Plan row. Every
 * other organization — including a brand-new signup — defaults to the
 * real, limited FREE tier below (see src/app/onboarding/actions.ts, which
 * creates a BillingAccount pointing at it at org-creation time) and must
 * genuinely upgrade to a paid tier to exceed those limits.
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

/** Every SUPPORTED_PLAN_CURRENCY set to 0 — used by FREE and CUSTOM, which are never charged. */
function zeroInEveryCurrency(): Record<SupportedPlanCurrency, number> {
  return Object.fromEntries(SUPPORTED_PLAN_CURRENCIES.map((c) => [c, 0])) as Record<SupportedPlanCurrency, number>;
}

// Documented, deliberately-rounded placeholder rates (NOT a live feed —
// see this file's module doc comment) used only to seed a reasonable
// starting local price for every non-USD tier below. A platform operator
// can freely hand-edit any resulting number later; nothing downstream
// re-derives these live.
const APPROX_USD_RATE: Record<SupportedPlanCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83,
  AED: 3.67,
  SAR: 3.75,
  CAD: 1.35,
  AUD: 1.5,
  SGD: 1.34,
  JPY: 150,
};

/** USD cents -> this currency's cents, rounded to a clean-looking number (nearest 100 for a 2-3 digit result, nearest 1000 above that) so seeded prices read like real list prices, not raw FX noise. */
function usdCentsToRoundedCurrency(usdCents: number, currency: SupportedPlanCurrency): number {
  if (usdCents === 0) return 0;
  const raw = usdCents * APPROX_USD_RATE[currency];
  const roundTo = raw >= 100_000 ? 10_000 : raw >= 10_000 ? 1_000 : 100;
  return Math.round(raw / roundTo) * roundTo;
}

/** USD keeps the exact, deliberately-typed price; every other currency gets the rounded approximate conversion. */
function byCurrency(usdCents: number): Record<SupportedPlanCurrency, number> {
  return Object.fromEntries(
    SUPPORTED_PLAN_CURRENCIES.map((c) => [c, c === "USD" ? usdCents : usdCentsToRoundedCurrency(usdCents, c)]),
  ) as Record<SupportedPlanCurrency, number>;
}

const GB = 1024;
const TB = 1024 * 1024;

const PLAN_TIERS: PlanTierSeed[] = [
  {
    tier: "FREE",
    name: "Free",
    description: "For a solo operator or a very small team trying GrowthOS out — real limits, no card required.",
    isCustom: false,
    monthlyPriceCentsByCurrency: zeroInEveryCurrency(),
    hasYearlySku: false,
    trialDays: 0,
    userLimit: 3,
    workspaceLimit: 1,
    aiCreditsMonthly: 500,
    storageMbLimit: 500,
    projectLimit: 3,
    clientLimit: 10,
    automationRunsMonthly: 100,
    knowledgeBaseMbLimit: 100,
    apiCallsMonthly: 1000,
    whiteLabelAccess: false,
    customDomainAccess: false,
    prioritySupport: false,
    ssoAccess: false,
    advancedAnalytics: false,
    features: [
      { key: "white_label", enabled: false },
      { key: "sso", enabled: false },
      { key: "analytics", enabled: false },
    ],
  },
  {
    tier: "STARTER",
    name: "Starter",
    description: "For a growing small business ready to run real client work through GrowthOS.",
    isCustom: false,
    monthlyPriceCentsByCurrency: byCurrency(2900),
    hasYearlySku: true,
    trialDays: 14,
    userLimit: 10,
    workspaceLimit: 1,
    aiCreditsMonthly: 2000,
    storageMbLimit: 5 * GB,
    projectLimit: 15,
    clientLimit: 100,
    automationRunsMonthly: 1000,
    knowledgeBaseMbLimit: 1 * GB,
    apiCallsMonthly: 10000,
    whiteLabelAccess: false,
    customDomainAccess: false,
    prioritySupport: false,
    ssoAccess: false,
    advancedAnalytics: false,
    features: [
      { key: "white_label", enabled: false },
      { key: "sso", enabled: false },
      { key: "analytics", enabled: false },
    ],
  },
  {
    tier: "PROFESSIONAL",
    name: "Professional",
    description: "For an established agency running multiple workspaces with real reporting needs.",
    isCustom: false,
    monthlyPriceCentsByCurrency: byCurrency(9900),
    hasYearlySku: true,
    trialDays: 14,
    userLimit: 25,
    workspaceLimit: 3,
    aiCreditsMonthly: 8000,
    storageMbLimit: 25 * GB,
    projectLimit: 50,
    clientLimit: 500,
    automationRunsMonthly: 5000,
    knowledgeBaseMbLimit: 5 * GB,
    apiCallsMonthly: 50000,
    whiteLabelAccess: false,
    customDomainAccess: false,
    prioritySupport: false,
    ssoAccess: false,
    advancedAnalytics: true,
    features: [
      { key: "white_label", enabled: false },
      { key: "sso", enabled: false },
      { key: "analytics", enabled: true },
    ],
  },
  {
    tier: "BUSINESS",
    name: "Business",
    description: "For a larger agency or reseller that needs white-labeling, a custom domain, and priority support.",
    isCustom: false,
    monthlyPriceCentsByCurrency: byCurrency(29900),
    hasYearlySku: true,
    trialDays: 14,
    userLimit: 100,
    workspaceLimit: 10,
    aiCreditsMonthly: 30000,
    storageMbLimit: 100 * GB,
    projectLimit: null,
    clientLimit: null,
    automationRunsMonthly: 25000,
    knowledgeBaseMbLimit: 25 * GB,
    apiCallsMonthly: 250000,
    whiteLabelAccess: true,
    customDomainAccess: true,
    prioritySupport: true,
    ssoAccess: false,
    advancedAnalytics: true,
    features: [
      { key: "white_label", enabled: true },
      { key: "sso", enabled: false },
      { key: "analytics", enabled: true },
    ],
  },
  {
    tier: "ENTERPRISE",
    name: "Enterprise",
    description: "For a large-scale deployment with unlimited seats/workspaces/projects and every platform feature enabled.",
    isCustom: false,
    monthlyPriceCentsByCurrency: byCurrency(99900),
    hasYearlySku: true,
    trialDays: 0,
    userLimit: null,
    workspaceLimit: null,
    aiCreditsMonthly: 150000,
    storageMbLimit: 1 * TB,
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
  {
    tier: "CUSTOM",
    name: "Custom",
    description:
      "A manually negotiated plan assigned by a platform operator (never self-service-purchased, never charged via a real checkout) — every limit is unlimited and every feature is enabled by default; the operator tailors actual pricing/terms off-platform.",
    isCustom: true,
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
        // Re-seeding a tier that a prior catalog change had archived (see
        // the archive step at the bottom of this function) must bring it
        // back ACTIVE — otherwise a restored tier stays invisible to every
        // ACTIVE-only query (the subscription page, getDefaultFreePlan)
        // forever, silently re-creating the exact "everyone's unlimited"
        // bug this restoration exists to fix.
        status: "ACTIVE",
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
  // these rows for any org that switched plans before a prior catalog
  // change) any previously-seeded tier that's no longer in PLAN_TIERS, so
  // the ACTIVE-only plan queries (e.g. the subscription page) only ever
  // list tiers this catalog currently defines.
  const currentTiers = PLAN_TIERS.map((t) => t.tier);
  await prisma.plan.updateMany({
    where: { status: "ACTIVE", tier: { notIn: currentTiers } },
    data: { status: "ARCHIVED" },
  });
}

/** The FREE tier's [MONTHLY, currency] Plan row — the real default every new non-owner-org signup is assigned to (see src/app/onboarding/actions.ts). */
export async function getDefaultFreePlan(currency: string) {
  const resolvedCurrency = (SUPPORTED_PLAN_CURRENCIES as readonly string[]).includes(currency) ? currency : "USD";
  return prisma.plan.findUnique({
    where: { tier_interval_currency: { tier: "FREE", interval: "MONTHLY", currency: resolvedCurrency } },
  });
}
