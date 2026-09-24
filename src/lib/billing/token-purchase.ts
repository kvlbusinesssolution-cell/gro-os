import { prisma } from "@/lib/prisma";
import { getGateway, listConfiguredGateways } from "./gateway/registry";
import type { NormalizedWebhookEvent } from "./gateway/types";
import { generatePlatformInvoice } from "./invoices";
import { ensureLedger } from "./growth-tokens";
import { logAudit } from "@/lib/audit";
import { TOKEN_PACKAGES, findTokenPackage, computeBonusTokens } from "./token-packages";
import type { PaymentGatewayProvider } from "@/generated/prisma/client";

export { TOKEN_PACKAGES, findTokenPackage };
export type { TokenPackage } from "./token-packages";

/**
 * Real Growth Token top-up purchase — clients/users/students paying to add
 * to GrowthTokenLedger.purchasedTokensRemaining, which growth-tokens.ts's
 * spendGrowthTokens already deducts from but nothing anywhere ever funded.
 * Reuses the platform gateway abstraction (src/lib/billing/gateway/*) and
 * mirrors src/lib/marketplace/checkout.ts's startMarketplaceCheckout/
 * fulfillMarketplaceOrder pattern verbatim — a token purchase is just
 * another PlatformInvoice under the buyer org's existing BillingAccount,
 * confirmed only by a real gateway webhook, never by client-side trust.
 *
 * Pricing: TOKEN_PURCHASE_RATE (token-packages.ts, 4 tokens per ₹1) —
 * deliberately distinct from TOKEN_VALUE_INR (token-pricing.ts's ₹1-per-
 * token peg every existing flat-fee Growth Token action is still priced
 * against). Plus a flat 20% bonus (PURCHASE_BONUS_RATE) credited on top
 * of every real purchase.
 */

const ONE_TIME_GATEWAY_PRIORITY: PaymentGatewayProvider[] = ["STRIPE", "RAZORPAY", "PADDLE", "MANUAL"];

async function getOrCreateBillingAccount(organizationId: string) {
  return prisma.billingAccount.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
}

export interface StartGrowthTokenPurchaseParams {
  organizationId: string;
  buyerUserId: string;
  packageId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StartGrowthTokenPurchaseResult {
  ok: boolean;
  error?: string;
  checkoutUrl?: string;
  requiresManualConfirmation?: boolean;
}

/** Starts a real checkout for one token package. Never persists a token credit itself — the webhook (handleGrowthTokenPurchaseWebhookEvent, dispatched from subscriptions.ts) is the sole source of truth for "did this org actually pay." */
export async function startGrowthTokenPurchase(params: StartGrowthTokenPurchaseParams): Promise<StartGrowthTokenPurchaseResult> {
  const pkg = findTokenPackage(params.packageId);
  if (!pkg) return { ok: false, error: "That token package doesn't exist." };

  const buyer = await prisma.user.findUnique({ where: { id: params.buyerUserId }, select: { email: true } });
  if (!buyer?.email) return { ok: false, error: "Your account has no email address on file." };

  const billingAccount = await getOrCreateBillingAccount(params.organizationId);

  const purchase = await prisma.growthTokenPurchase.create({
    data: {
      organizationId: params.organizationId,
      buyerUserId: params.buyerUserId,
      tokens: pkg.tokens,
      bonusTokens: computeBonusTokens(pkg.tokens),
      amountCents: pkg.amountCents,
      currency: "INR",
      status: "PENDING",
    },
  });

  const configured = new Set(listConfiguredGateways().map((g) => g.provider));

  let lastError: string | null = null;
  for (const provider of ONE_TIME_GATEWAY_PRIORITY) {
    if (!configured.has(provider)) continue;
    try {
      const gateway = getGateway(provider);
      const session = await gateway.createCheckoutSession({
        organizationId: params.organizationId,
        billingAccountId: billingAccount.id,
        gatewayCustomerId: billingAccount.gatewayCustomerId,
        mode: "payment",
        amountCents: pkg.amountCents,
        currency: "INR",
        lineItemName: `${pkg.tokens} Growth Tokens (${pkg.label}) + ${computeBonusTokens(pkg.tokens)} bonus`,
        customerEmail: buyer.email,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        trialDays: 0,
        metadata: { kind: "growth_token_purchase", growthTokenPurchaseId: purchase.id },
      });

      await prisma.growthTokenPurchase.update({
        where: { id: purchase.id },
        data: { gatewayProvider: provider, gatewayCheckoutSessionId: session.gatewaySessionId },
      });

      return { ok: true, checkoutUrl: session.checkoutUrl, requiresManualConfirmation: provider === "MANUAL" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue; // try the next configured gateway rather than failing the whole checkout on one provider's real limitation
    }
  }

  await prisma.growthTokenPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
  return { ok: false, error: lastError ?? "No payment method is available yet — ask an admin to configure a payment gateway." };
}

/**
 * Shared fulfillment core — called from the real gateway webhook handler.
 * Idempotent: a duplicate webhook delivery for an already-PAID purchase is
 * a no-op, never a double-credit.
 */
export async function fulfillGrowthTokenPurchase(purchaseId: string, opts: { gatewayPaymentId?: string; provider?: PaymentGatewayProvider } = {}): Promise<void> {
  const purchase = await prisma.growthTokenPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
  if (purchase.status === "PAID") return;

  const billingAccount = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId: purchase.organizationId } });
  const provider = opts.provider ?? purchase.gatewayProvider ?? "MANUAL";

  const invoice = await generatePlatformInvoice(
    billingAccount.id,
    [{ description: `${purchase.tokens} Growth Tokens + ${purchase.bonusTokens} bonus (20%)`, quantity: 1, unitAmountCents: purchase.amountCents }],
    "RECEIPT",
    purchase.currency,
  );

  await ensureLedger(billingAccount.id);
  const totalCredited = purchase.tokens + purchase.bonusTokens;

  await prisma.$transaction(async (tx) => {
    await tx.platformPayment.create({
      data: {
        organizationId: purchase.organizationId,
        billingAccountId: billingAccount.id,
        invoiceId: invoice.id,
        provider,
        status: "SUCCEEDED",
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        gatewayPaymentId: opts.gatewayPaymentId,
        gatewayChargeId: opts.gatewayPaymentId,
        paidAt: new Date(),
      },
    });
    await tx.platformInvoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: new Date(), amountPaidCents: { increment: purchase.amountCents } },
    });
    await tx.growthTokenLedger.update({
      where: { billingAccountId: billingAccount.id },
      data: { purchasedTokensRemaining: { increment: totalCredited } },
    });
    await tx.growthTokenPurchase.update({
      where: { id: purchase.id },
      data: { status: "PAID", platformInvoiceId: invoice.id, gatewayProvider: provider },
    });
  });

  await logAudit({
    organizationId: purchase.organizationId,
    action: "billing.growth_token_purchase.fulfilled",
    metadata: { purchaseId: purchase.id, tokens: purchase.tokens, bonusTokens: purchase.bonusTokens, totalCredited, provider },
  });
}

/** Operator/OWNER-initiated confirmation for a MANUAL-gateway purchase — same posture as markManualMarketplaceOrderPaid. */
export async function markManualGrowthTokenPurchasePaid(purchaseId: string, markedByUserId: string): Promise<{ ok: boolean; error?: string }> {
  const purchase = await prisma.growthTokenPurchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return { ok: false, error: "Purchase not found." };
  if (purchase.gatewayProvider !== "MANUAL") return { ok: false, error: "This purchase was not started via Manual/Bank Transfer." };
  if (purchase.status === "PAID") return { ok: true };

  try {
    await fulfillGrowthTokenPurchase(purchaseId, { provider: "MANUAL" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not fulfill this purchase." };
  }
  await logAudit({ userId: markedByUserId, organizationId: purchase.organizationId, action: "billing.growth_token_purchase.manual_payment_confirmed", metadata: { purchaseId } });
  return { ok: true };
}

/**
 * Called from the metadata-first branch in
 * src/lib/billing/subscriptions.ts's handleGatewayWebhookEvent() when
 * event.metadata.kind === "growth_token_purchase" — mirrors
 * handleMarketplaceOrderWebhookEvent's exact dispatch shape.
 */
export async function handleGrowthTokenPurchaseWebhookEvent(provider: PaymentGatewayProvider, event: NormalizedWebhookEvent): Promise<void> {
  const purchaseId = event.metadata?.growthTokenPurchaseId;
  if (!purchaseId) return;

  switch (event.type) {
    case "checkout.completed":
    case "invoice.paid":
      await fulfillGrowthTokenPurchase(purchaseId, { gatewayPaymentId: event.gatewayPaymentId, provider });
      break;
    case "invoice.payment_failed":
      await prisma.growthTokenPurchase.update({ where: { id: purchaseId }, data: { status: "FAILED" } }).catch(() => {});
      break;
    case "charge.refunded": {
      // The refund already happened at the gateway — this just syncs local
      // state, never calls gateway.createRefund() again (that would
      // double-refund). Clamped so a purchase whose tokens were already
      // partially/fully spent can never be clawed back below zero.
      const purchase = await prisma.growthTokenPurchase.findUnique({ where: { id: purchaseId } });
      if (purchase?.status === "PAID") {
        const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId: purchase.organizationId } });
        if (billingAccount) {
          const ledger = await ensureLedger(billingAccount.id);
          const decrementBy = Math.min(purchase.tokens + purchase.bonusTokens, ledger.purchasedTokensRemaining);
          await prisma.growthTokenLedger.update({ where: { billingAccountId: billingAccount.id }, data: { purchasedTokensRemaining: { decrement: decrementBy } } });
        }
        await prisma.growthTokenPurchase.update({ where: { id: purchaseId }, data: { status: "REFUNDED" } });
      }
      break;
    }
    default:
      break;
  }
}
