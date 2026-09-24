/**
 * Token pricing calculator — the real, inspectable "reference cost -> token
 * price" methodology behind Growth Tokens (src/lib/billing/growth-tokens.ts)
 * and any future non-AI paid action. Two rules define every price here,
 * both explicit founder decisions:
 *
 * 1. Token price = a reference PAID-MARKET cost for that action, times
 *    TOKEN_MARKUP_MULTIPLIER. The reference cost is what a comparable paid
 *    service would charge — NEVER what KVL actually pays.
 * 2. That price holds even when KVL's real cost for the underlying service
 *    is ₹0 (a free tier). The owner's margin is pegged to the reference
 *    cost, not to KVL's marginal cost, so "use free infrastructure, still
 *    charge full price" stays consistent rather than collapsing to ₹0.
 *
 * REFERENCE_COST_INR intentionally includes entries beyond today's two
 * gated Growth Token actions (WhatsApp/SMS/AI-voice) so this calculator is
 * ready for the next channel, not a one-off table for just these two.
 * Adding a real gated action for one of those later means wiring a new
 * GrowthTokenAction (or a sibling ledger) — this file only prices it.
 */

import { TOKEN_PURCHASE_RATE } from "./token-packages";

export const TOKEN_MARKUP_MULTIPLIER = 4;

/** 1 Growth Token = this many INR of reference value — the unit peg every price below is computed against. */
export const TOKEN_VALUE_INR = 1;

export const REFERENCE_COST_INR = {
  LISTING_PUBLISH: 15, // nominal value of a paid local-directory placement
  DEAL_POST: 5,
  LISTING_FEATURE: 40, // nominal value of a 7-day boosted/top-of-search placement, real local-directory ad-slot pricing
  CATALOG_ITEM_PUBLISH: 3, // nominal value of listing one priced product/service line in a paid e-catalog
  LANDING_PAGE_PUBLISH: 25, // nominal per-page value on a real paid landing-page-builder plan (Leadpages/Unbounce-tier pricing prorated per page)
  REPUTATION_CERTIFICATE_DOWNLOAD: 15, // nominal value of a real third-party reputation/trust-badge certificate service
  AD_PLACEMENT_PURCHASE: 50, // nominal value of a real 7-day dedicated local-directory ad slot — priced above LISTING_FEATURE since it's a dedicated slot, not just a sort-order boost
  MICROSITE_PUBLISH: 100, // nominal value of a real small-business "starter website" service tier (Wix/GoDaddy-class basic site builder)

  // Not yet wired to a gated action in this codebase (no WhatsApp/SMS/voice
  // integration exists here today) — present so the calculator already
  // covers the next likely feature, priced against real market rates:
  WHATSAPP_MESSAGE: 0.8, // real Meta business-template message cost, India
  SMS_MESSAGE: 0.2,
  AI_VOICE_CALL_MINUTE: 8,
} as const;

export type TokenPricedReference = keyof typeof REFERENCE_COST_INR;

/** Reference cost (INR) x TOKEN_MARKUP_MULTIPLIER, converted to whole tokens via TOKEN_VALUE_INR. Rounds up — the owner's floor is never eroded by rounding. */
export function computeTokenPrice(referenceKey: TokenPricedReference): number {
  return Math.ceil((REFERENCE_COST_INR[referenceKey] * TOKEN_MARKUP_MULTIPLIER) / TOKEN_VALUE_INR);
}

export interface TokenPricingRow {
  referenceKey: TokenPricedReference;
  referenceCostInr: number;
  multiplier: number;
  tokenValueInr: number;
  tokenPrice: number;
}

/** Every priced reference, for the read-only admin display (src/app/dashboard/billing/token-pricing/page.tsx). */
export function listTokenPricing(): TokenPricingRow[] {
  return (Object.keys(REFERENCE_COST_INR) as TokenPricedReference[]).map((referenceKey) => ({
    referenceKey,
    referenceCostInr: REFERENCE_COST_INR[referenceKey],
    multiplier: TOKEN_MARKUP_MULTIPLIER,
    tokenValueInr: TOKEN_VALUE_INR,
    tokenPrice: computeTokenPrice(referenceKey),
  }));
}

// Deliberately defined HERE, not in growth-tokens.ts, even though it's the
// real per-GrowthTokenAction price table that module uses to gate spends:
// this file has zero dependency on @/lib/prisma, so "use client" components
// (publish-listing-button.tsx, deal-row-actions.tsx) can safely import just
// this constant to render "Publish (N tokens)" without pulling the Prisma
// client — and its `pg`/Node-builtins dependency chain — into the browser
// bundle. Importing GROWTH_TOKEN_COST from growth-tokens.ts instead broke
// exactly that (Turbopack included @/lib/prisma's whole module graph in the
// client bundle since growth-tokens.ts imports it at the top level,
// regardless of which named export a client component actually uses).
export type GrowthTokenActionKey =
  | "LISTING_PUBLISH"
  | "DEAL_POST"
  | "LISTING_FEATURE"
  | "CATALOG_ITEM_PUBLISH"
  | "LANDING_PAGE_PUBLISH"
  | "REPUTATION_CERTIFICATE_DOWNLOAD"
  | "AD_PLACEMENT_PURCHASE"
  | "MICROSITE_PUBLISH";

export const GROWTH_TOKEN_COST: Record<GrowthTokenActionKey, number> = {
  LISTING_PUBLISH: computeTokenPrice("LISTING_PUBLISH"),
  DEAL_POST: computeTokenPrice("DEAL_POST"),
  LISTING_FEATURE: computeTokenPrice("LISTING_FEATURE"),
  CATALOG_ITEM_PUBLISH: computeTokenPrice("CATALOG_ITEM_PUBLISH"),
  LANDING_PAGE_PUBLISH: computeTokenPrice("LANDING_PAGE_PUBLISH"),
  REPUTATION_CERTIFICATE_DOWNLOAD: computeTokenPrice("REPUTATION_CERTIFICATE_DOWNLOAD"),
  AD_PLACEMENT_PURCHASE: computeTokenPrice("AD_PLACEMENT_PURCHASE"),
  MICROSITE_PUBLISH: computeTokenPrice("MICROSITE_PUBLISH"),
};

/** How long one Feature-listing spend keeps a listing boosted — see featureListing in listing-actions.ts. */
export const LISTING_FEATURE_DURATION_DAYS = 7;

/**
 * Founder decision (2026-09): for a genuinely METERED, pass-through cost
 * (a real AI-provider bill, not a flat reference-cost action above), the
 * markup is a straight percentage on the REAL cost incurred, not the
 * REFERENCE_COST_INR x 4 rule — a metered cost has no stable "market
 * reference price" to peg against the way a flat feature does. Converted
 * to tokens at TOKEN_PURCHASE_RATE (token-packages.ts's 4-tokens-per-₹1
 * rate), NOT TOKEN_VALUE_INR — this is the same real-money rate a token
 * purchase itself uses, since a metered charge is effectively "spend real
 * ₹ worth of tokens," not a flat feature-cost lookup.
 *
 * Worked example (the founder's own, verbatim): ₹100 real API cost -> x1.8
 * = ₹180 charged -> x4 = 720 tokens.
 *
 * Wired to a real spend path: src/lib/billing/ai-credits.ts's recordAIUsage
 * calls computeRealApiCostInr (that file) to get realApiCostInr, then
 * growth-tokens.ts's recordApiUsageTokenSpend calls computeApiCostTokens
 * (this function) and debits the org's Growth Token ledger for it — on
 * every real AI call, alongside (never instead of) the existing AI Credits
 * ledger, which keeps recording its own separate abstract credit units
 * exactly as it always has.
 */
export const API_COST_MARKUP_MULTIPLIER = 1.8; // 80% markup on top of the real, metered cost incurred

export function computeApiCostTokens(realApiCostInr: number): number {
  return Math.ceil(realApiCostInr * API_COST_MARKUP_MULTIPLIER * TOKEN_PURCHASE_RATE);
}
