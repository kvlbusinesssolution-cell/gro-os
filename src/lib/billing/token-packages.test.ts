import { describe, expect, it } from "vitest";

import { TOKEN_PACKAGES, TOKEN_PURCHASE_RATE, PURCHASE_BONUS_RATE, computeBonusTokens, findTokenPackage } from "./token-packages";

describe("token-packages.ts", () => {
  it("every package is priced at exactly TOKEN_PURCHASE_RATE tokens per ₹1", () => {
    for (const pkg of TOKEN_PACKAGES) {
      const priceInr = pkg.amountCents / 100;
      expect(pkg.tokens).toBe(priceInr * TOKEN_PURCHASE_RATE);
    }
  });

  it("findTokenPackage finds a real package by id and returns undefined for an unknown one", () => {
    expect(findTokenPackage("starter")?.tokens).toBe(400);
    expect(findTokenPackage("not-a-real-id")).toBeUndefined();
  });

  it("computeBonusTokens applies the flat 20% promo, rounded to the nearest whole token", () => {
    expect(PURCHASE_BONUS_RATE).toBe(0.2);
    expect(computeBonusTokens(400)).toBe(80);
    expect(computeBonusTokens(500)).toBe(100);
    // 15 * 0.2 = 3 exactly, no rounding ambiguity to worry about in this case;
    // a genuinely fractional case (odd tokens) still rounds sanely.
    expect(computeBonusTokens(15)).toBe(3);
    expect(computeBonusTokens(17)).toBe(3); // 3.4 -> rounds to 3
  });
});
