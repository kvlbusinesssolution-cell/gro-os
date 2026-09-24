/**
 * Real Growth Token package catalog — deliberately zero-dependency (no
 * @/lib/prisma import), same reasoning as token-pricing.ts's own doc
 * comment: a "use client" package-picker component must be able to import
 * this constant directly without pulling Prisma's whole module graph into
 * the browser bundle. token-purchase.ts (the server-side checkout/
 * fulfillment logic) re-exports these for server callers that already
 * import from that file.
 *
 * Pricing: TOKEN_PURCHASE_RATE (4 tokens per ₹1) — a deliberately DIFFERENT
 * rate from TOKEN_VALUE_INR (token-pricing.ts's ₹1-per-token peg that
 * every existing flat-fee Growth Token action, e.g. LISTING_PUBLISH, is
 * still priced against). Founder decision (2026-09): a real, purchasable
 * token is worth less per-rupee than the token-cost numbers already baked
 * into every existing feature, rather than repricing those existing
 * numbers — this file governs only what a buyer receives for real money,
 * never what a feature costs to use.
 *
 * A 20% purchase bonus (fulfillGrowthTokenPurchase in token-purchase.ts)
 * is added on top of every package's own tokens at fulfillment time — not
 * baked into these numbers, so the bonus rate can change independently of
 * the base package sizes.
 */

export const TOKEN_PURCHASE_RATE = 4; // tokens credited per ₹1 paid, for a real token-purchase checkout

// Founder promo (2026-09): a flat 20% bonus on every real token purchase,
// on top of the package's own tokens — see GrowthTokenPurchase.bonusTokens
// (snapshotted at checkout-start time) and fulfillGrowthTokenPurchase in
// token-purchase.ts (credits tokens + bonusTokens together).
export const PURCHASE_BONUS_RATE = 0.2;

export function computeBonusTokens(tokens: number): number {
  return Math.round(tokens * PURCHASE_BONUS_RATE);
}

export interface TokenPackage {
  id: string;
  label: string;
  tokens: number;
  amountCents: number;
}

function packageFor(id: string, label: string, priceInr: number): TokenPackage {
  return { id, label, tokens: priceInr * TOKEN_PURCHASE_RATE, amountCents: priceInr * 100 };
}

export const TOKEN_PACKAGES: TokenPackage[] = [
  packageFor("starter", "Starter", 100),
  packageFor("growth", "Growth", 500),
  packageFor("scale", "Scale", 1_000),
  packageFor("pro", "Pro", 2_500),
  packageFor("enterprise", "Enterprise", 5_000),
];

export function findTokenPackage(packageId: string): TokenPackage | undefined {
  return TOKEN_PACKAGES.find((p) => p.id === packageId);
}
