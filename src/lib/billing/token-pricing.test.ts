import { describe, expect, it } from "vitest";

import {
  computeTokenPrice,
  listTokenPricing,
  computeApiCostTokens,
  API_COST_MARKUP_MULTIPLIER,
  GROWTH_TOKEN_COST,
  REFERENCE_COST_INR,
  TOKEN_MARKUP_MULTIPLIER,
  TOKEN_VALUE_INR,
  type TokenPricedReference,
} from "./token-pricing";
import { TOKEN_PURCHASE_RATE } from "./token-packages";

describe("token-pricing.ts — 4x-markup calculator", () => {
  it("rounds a fractional reference-cost x multiplier product UP, never down (owner's floor is never eroded)", () => {
    // WHATSAPP_MESSAGE: 0.8 * 4 = 3.2 -> ceil(3.2) = 4, not 3.
    expect(computeTokenPrice("WHATSAPP_MESSAGE")).toBe(4);
    // SMS_MESSAGE: 0.2 * 4 = 0.8 -> ceil(0.8) = 1, not 0.
    expect(computeTokenPrice("SMS_MESSAGE")).toBe(1);
  });

  it("computes an exact integer product without spurious rounding", () => {
    // LISTING_PUBLISH: 15 * 4 = 60 exactly.
    expect(computeTokenPrice("LISTING_PUBLISH")).toBe(60);
  });

  it("applies TOKEN_MARKUP_MULTIPLIER (4x) and TOKEN_VALUE_INR consistently for every reference key", () => {
    expect(TOKEN_MARKUP_MULTIPLIER).toBe(4);
    for (const key of Object.keys(REFERENCE_COST_INR) as TokenPricedReference[]) {
      const expected = Math.ceil((REFERENCE_COST_INR[key] * TOKEN_MARKUP_MULTIPLIER) / TOKEN_VALUE_INR);
      expect(computeTokenPrice(key)).toBe(expected);
    }
  });

  it("listTokenPricing() returns one correctly-shaped row per reference key", () => {
    const rows = listTokenPricing();
    const keys = Object.keys(REFERENCE_COST_INR);
    expect(rows).toHaveLength(keys.length);

    for (const row of rows) {
      expect(row.referenceCostInr).toBe(REFERENCE_COST_INR[row.referenceKey]);
      expect(row.multiplier).toBe(TOKEN_MARKUP_MULTIPLIER);
      expect(row.tokenValueInr).toBe(TOKEN_VALUE_INR);
      expect(row.tokenPrice).toBe(computeTokenPrice(row.referenceKey));
    }
  });

  it("GROWTH_TOKEN_COST (the table growth-tokens.ts actually gates spends against) matches computeTokenPrice for every wired action", () => {
    for (const key of Object.keys(GROWTH_TOKEN_COST) as Array<keyof typeof GROWTH_TOKEN_COST>) {
      expect(GROWTH_TOKEN_COST[key]).toBe(computeTokenPrice(key));
    }
  });

  it("every currently-gated Growth Token action has a real reference-cost entry", () => {
    const gated: TokenPricedReference[] = ["LISTING_PUBLISH", "DEAL_POST", "LISTING_FEATURE", "CATALOG_ITEM_PUBLISH"];
    for (const key of gated) {
      expect(REFERENCE_COST_INR[key]).toBeGreaterThan(0);
    }
  });
});

describe("token-pricing.ts — computeApiCostTokens (real metered API-cost passthrough)", () => {
  it("matches the founder's own worked example exactly: ₹100 real cost -> ₹180 charged -> 720 tokens", () => {
    expect(API_COST_MARKUP_MULTIPLIER).toBe(1.8);
    expect(TOKEN_PURCHASE_RATE).toBe(4);
    expect(computeApiCostTokens(100)).toBe(720);
  });

  it("rounds a fractional result UP, never down", () => {
    // ₹1 -> x1.8 = ₹1.8 -> x4 = 7.2 -> ceil = 8, never 7.
    expect(computeApiCostTokens(1)).toBe(8);
  });

  it("returns 0 tokens for a genuinely zero real cost — never fabricates a charge", () => {
    expect(computeApiCostTokens(0)).toBe(0);
  });
});
