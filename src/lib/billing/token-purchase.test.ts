import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const getGateway = vi.fn();
const listConfiguredGateways = vi.fn();
vi.mock("./gateway/registry", () => ({
  getGateway: (...args: unknown[]) => getGateway(...args),
  listConfiguredGateways: (...args: unknown[]) => listConfiguredGateways(...args),
}));

const { prisma } = await import("@/lib/prisma");
const { TOKEN_PACKAGES } = await import("./token-packages");
const { startGrowthTokenPurchase, fulfillGrowthTokenPurchase, handleGrowthTokenPurchaseWebhookEvent } = await import("./token-purchase");

/**
 * Real Postgres integration test (matches growth-tokens.test.ts's own
 * convention — no mocking of prisma) for the one piece the ledger's spend
 * side never had: a real way to CREDIT purchasedTokensRemaining. Only the
 * external gateway boundary (getGateway/listConfiguredGateways) is mocked
 * — a real network call to Razorpay/Stripe must never happen in a test.
 */
describe("token-purchase.ts", () => {
  describe("TOKEN_PACKAGES", () => {
    it("every package is priced at exactly TOKEN_PURCHASE_RATE (4) tokens per ₹1 — never a silent discount from the established rate", () => {
      for (const pkg of TOKEN_PACKAGES) {
        expect(pkg.tokens).toBe((pkg.amountCents / 100) * 4);
      }
    });
  });

  describe("real Postgres flows", () => {
    const suffix = Date.now();
    let organizationId: string;
    let buyerUserId: string;

    beforeAll(async () => {
      const org = await prisma.organization.create({ data: { name: "Token Purchase Test Org", slug: `token-purchase-test-${suffix}` } });
      organizationId = org.id;
      const user = await prisma.user.create({ data: { name: "Token Buyer", email: `token-buyer-${suffix}@example.com` } });
      buyerUserId = user.id;
      await prisma.billingAccount.create({ data: { organizationId } });
    });

    afterAll(async () => {
      await prisma.growthTokenPurchase.deleteMany({ where: { organizationId } });
      await prisma.platformPayment.deleteMany({ where: { organizationId } });
      await prisma.platformInvoiceItem.deleteMany({ where: { invoice: { organizationId } } });
      await prisma.platformInvoice.deleteMany({ where: { organizationId } });
      await prisma.growthTokenLedger.deleteMany({ where: { billingAccount: { organizationId } } });
      await prisma.billingAccount.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
      await prisma.user.delete({ where: { id: buyerUserId } });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("startGrowthTokenPurchase: rejects an unknown package id without creating any real row", async () => {
      const before = await prisma.growthTokenPurchase.count({ where: { organizationId } });
      const result = await startGrowthTokenPurchase({ organizationId, buyerUserId, packageId: "not-a-real-package", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/cancel" });
      expect(result.ok).toBe(false);
      const after = await prisma.growthTokenPurchase.count({ where: { organizationId } });
      expect(after).toBe(before);
    });

    it("startGrowthTokenPurchase: creates a real PENDING purchase and returns the gateway's real checkout URL", async () => {
      listConfiguredGateways.mockReturnValue([{ provider: "RAZORPAY" }]);
      getGateway.mockReturnValue({
        createCheckoutSession: vi.fn().mockResolvedValue({ checkoutUrl: "https://razorpay.example/pay/abc", gatewaySessionId: "plink_abc" }),
      });

      const result = await startGrowthTokenPurchase({ organizationId, buyerUserId, packageId: "starter", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/cancel" });

      expect(result).toEqual({ ok: true, checkoutUrl: "https://razorpay.example/pay/abc", requiresManualConfirmation: false });

      const purchase = await prisma.growthTokenPurchase.findFirst({ where: { organizationId, tokens: 400 }, orderBy: { createdAt: "desc" } });
      expect(purchase).not.toBeNull();
      expect(purchase?.status).toBe("PENDING");
      expect(purchase?.amountCents).toBe(10_000); // ₹100
      expect(purchase?.bonusTokens).toBe(80); // 20% of 400
      expect(purchase?.gatewayCheckoutSessionId).toBe("plink_abc");
    });

    it("startGrowthTokenPurchase: honestly fails (never fakes a checkout URL) when no gateway is configured", async () => {
      listConfiguredGateways.mockReturnValue([]);

      const result = await startGrowthTokenPurchase({ organizationId, buyerUserId, packageId: "starter", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/cancel" });

      expect(result.ok).toBe(false);
      expect(result.checkoutUrl).toBeUndefined();
      const purchase = await prisma.growthTokenPurchase.findFirst({ where: { organizationId, tokens: 400 }, orderBy: { createdAt: "desc" } });
      expect(purchase?.status).toBe("FAILED");
    });

    it("fulfillGrowthTokenPurchase: credits purchasedTokensRemaining (tokens + the 20% bonus), creates a real PAID invoice, and is idempotent on a duplicate call", async () => {
      const purchase = await prisma.growthTokenPurchase.create({
        data: { organizationId, buyerUserId, tokens: 500, bonusTokens: 100, amountCents: 50_000, currency: "INR", status: "PENDING" },
      });

      await fulfillGrowthTokenPurchase(purchase.id, { gatewayPaymentId: "pay_123", provider: "RAZORPAY" });

      const billingAccount = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } });
      const ledgerAfterFirst = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });
      expect(ledgerAfterFirst.purchasedTokensRemaining).toBe(600); // 500 + 100 bonus

      const updated = await prisma.growthTokenPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(updated.status).toBe("PAID");
      expect(updated.platformInvoiceId).not.toBeNull();

      const invoice = await prisma.platformInvoice.findUniqueOrThrow({ where: { id: updated.platformInvoiceId! } });
      expect(invoice.status).toBe("PAID");
      expect(invoice.totalCents).toBeGreaterThanOrEqual(50_000);

      // Duplicate webhook delivery — must never double-credit.
      await fulfillGrowthTokenPurchase(purchase.id, { gatewayPaymentId: "pay_123", provider: "RAZORPAY" });
      const ledgerAfterSecond = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });
      expect(ledgerAfterSecond.purchasedTokensRemaining).toBe(600);
    });

    it("handleGrowthTokenPurchaseWebhookEvent: checkout.completed fulfills the real purchase, including its bonus tokens", async () => {
      const purchase = await prisma.growthTokenPurchase.create({
        data: { organizationId, buyerUserId, tokens: 1_000, bonusTokens: 200, amountCents: 100_000, currency: "INR", status: "PENDING" },
      });
      const billingAccount = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } });
      const before = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });

      await handleGrowthTokenPurchaseWebhookEvent("RAZORPAY", {
        type: "checkout.completed",
        gatewayEventId: "evt_1",
        metadata: { growthTokenPurchaseId: purchase.id },
        raw: {},
      });

      const after = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });
      expect(after.purchasedTokensRemaining).toBe(before.purchasedTokensRemaining + 1_200); // 1000 + 200 bonus

      const updated = await prisma.growthTokenPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(updated.status).toBe("PAID");
    });

    it("handleGrowthTokenPurchaseWebhookEvent: invoice.payment_failed marks the purchase FAILED without touching the ledger", async () => {
      const purchase = await prisma.growthTokenPurchase.create({
        data: { organizationId, buyerUserId, tokens: 250, amountCents: 25_000, currency: "INR", status: "PENDING" },
      });
      const billingAccount = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } });
      const before = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });

      await handleGrowthTokenPurchaseWebhookEvent("RAZORPAY", {
        type: "invoice.payment_failed",
        gatewayEventId: "evt_2",
        metadata: { growthTokenPurchaseId: purchase.id },
        raw: {},
      });

      const after = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });
      expect(after.purchasedTokensRemaining).toBe(before.purchasedTokensRemaining);

      const updated = await prisma.growthTokenPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(updated.status).toBe("FAILED");
    });

    it("handleGrowthTokenPurchaseWebhookEvent: charge.refunded decrements the real ledger by tokens + bonusTokens together, clamped so it never goes negative", async () => {
      const purchase = await prisma.growthTokenPurchase.create({
        data: { organizationId, buyerUserId, tokens: 300, bonusTokens: 60, amountCents: 30_000, currency: "INR", status: "PENDING" },
      });
      await fulfillGrowthTokenPurchase(purchase.id, { provider: "RAZORPAY" });

      const billingAccount = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } });
      // Spend most of it away first, leaving less than the purchase's own 360 tokens (300 + 60 bonus) in the purchased bucket.
      await prisma.growthTokenLedger.update({ where: { billingAccountId: billingAccount.id }, data: { purchasedTokensRemaining: 100 } });

      await handleGrowthTokenPurchaseWebhookEvent("RAZORPAY", {
        type: "charge.refunded",
        gatewayEventId: "evt_3",
        metadata: { growthTokenPurchaseId: purchase.id },
        raw: {},
      });

      const after = await prisma.growthTokenLedger.findUniqueOrThrow({ where: { billingAccountId: billingAccount.id } });
      expect(after.purchasedTokensRemaining).toBe(0); // clamped — never negative, even though the purchase credited 360 tokens

      const updated = await prisma.growthTokenPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(updated.status).toBe("REFUNDED");
    });

    it("handleGrowthTokenPurchaseWebhookEvent: a real webhook event with no matching purchase id is a safe no-op", async () => {
      await expect(
        handleGrowthTokenPurchaseWebhookEvent("RAZORPAY", { type: "checkout.completed", gatewayEventId: "evt_4", metadata: {}, raw: {} }),
      ).resolves.not.toThrow();
    });
  });
});
