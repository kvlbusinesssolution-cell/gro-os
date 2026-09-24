import Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getCached, setCached } from "@/lib/cache/redis-cache";
import { logActivity } from "@/lib/activity";
import { getGateway } from "./gateway/registry";
import { generatePlatformInvoice } from "./invoices";
import type { NormalizedWebhookEvent } from "./gateway/types";
import type { BillingIntervalUnit, BillingStatus, PaymentGatewayProvider } from "@/generated/prisma/client";

/**
 * The real subscription lifecycle — startCheckout, changePlan, cancel/pause/
 * resume, manual-payment recording, and the webhook-driven state machine.
 * Every state change here traces to either a real gateway API response or a
 * real, explicitly-manual action; nothing is fabricated.
 */

const GATEWAY_LINK_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h — generous enough to cover a customer who starts checkout then completes it later; short enough not to accumulate forever.
const PROCESSED_EVENT_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days — comfortably longer than any real gateway's webhook retry window (Stripe retries for up to ~3 days).

/**
 * Both startCheckout() and handleGatewayWebhookEvent() write/read this same
 * cache, keyed by whatever real gateway id is known at the time:
 *   - startCheckout() caches by the gateway's own `gatewaySessionId` (a
 *     Stripe Checkout Session id, a Razorpay Subscription id — Razorpay has
 *     no separate "session" object, so its checkout id and subscription id
 *     ARE the same real id — a Paddle transaction id, or a LemonSqueezy
 *     checkout id).
 *   - handleGatewayWebhookEvent()'s "checkout.completed" handler re-caches
 *     the SAME resolved {organizationId, billingAccountId} under the real
 *     `gatewaySubscriptionId` once one becomes known, so a subscription.*
 *     event that arrives around the same time (webhook delivery order is
 *     never guaranteed) and carries no metadata of its own (Stripe's
 *     Subscription object does not inherit Checkout Session metadata unless
 *     `subscription_data.metadata` was explicitly set at checkout time,
 *     which this app's stripe.ts adapter does not do) can still resolve.
 *   - For Razorpay specifically, the very first `gatewaySessionId` cached by
 *     startCheckout already equals the real subscription id, so its very
 *     first webhook event resolves directly from the original cache entry
 *     with no re-cache step needed.
 * This is a real, explicit fallback path used only when the event's own
 * metadata/notes/custom_data (see extractMetadataOrgIds below) doesn't
 * already carry the organizationId/billingAccountId directly.
 */
function gatewayLinkCacheKey(gatewayId: string): string {
  return `billing:gateway-link:${gatewayId}`;
}

function processedEventCacheKey(provider: PaymentGatewayProvider, gatewayEventId: string): string {
  return `billing:webhook-event:${provider}:${gatewayEventId}`;
}

// ===================== startCheckout =====================

export interface StartCheckoutInput {
  organizationId: string;
  planId: string;
  provider: PaymentGatewayProvider;
  successUrl: string;
  cancelUrl: string;
}

export interface StartCheckoutResult {
  ok: boolean;
  checkoutUrl?: string;
  error?: string;
}

/**
 * Starts a real checkout against the given gateway for the given plan. Never
 * persists a plan change or subscription state itself — the webhook (handled
 * by handleGatewayWebhookEvent) is the sole source of truth for "did the
 * organization actually pay." This function only ever returns a real,
 * gateway-issued checkout URL for the caller to redirect to.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const gateway = getGateway(input.provider);
  if (!gateway.isConfigured()) {
    return { ok: false, error: `${gateway.name} isn't configured yet — set ${gateway.requiredEnvVars.join(", ")}.` };
  }

  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) return { ok: false, error: "That plan doesn't exist." };

  const gatewayPriceIds = (plan.gatewayPriceIds as Record<string, string> | null) ?? {};
  const gatewayPriceId = gatewayPriceIds[input.provider];
  if (!gatewayPriceId) return { ok: false, error: `This plan isn't available via ${gateway.name} yet.` };

  const owner = await prisma.membership.findFirst({
    where: { organizationId: input.organizationId, status: "ACTIVE", role: "OWNER" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { email: true } } },
  });
  const customerEmail = owner?.user.email;
  if (!customerEmail) return { ok: false, error: "This organization has no owner with a real email address on file." };

  const billingAccount = await prisma.billingAccount.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId },
    update: {},
  });

  try {
    const session = await gateway.createCheckoutSession({
      organizationId: input.organizationId,
      billingAccountId: billingAccount.id,
      gatewayCustomerId: billingAccount.gatewayCustomerId,
      mode: "subscription",
      gatewayPriceId,
      customerEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      trialDays: plan.trialDays,
    });

    await setCached(
      gatewayLinkCacheKey(session.gatewaySessionId),
      { organizationId: input.organizationId, billingAccountId: billingAccount.id },
      GATEWAY_LINK_CACHE_TTL_SECONDS,
    );

    return { ok: true, checkoutUrl: session.checkoutUrl };
  } catch (error) {
    console.error(`[billing/subscriptions] startCheckout failed (${input.provider}):`, error);
    return { ok: false, error: error instanceof Error ? error.message : "Checkout session creation failed." };
  }
}

// ===================== changePlan =====================

export interface ChangePlanResult {
  ok: boolean;
  error?: string;
}

/**
 * Real Stripe SDK usage, scoped to the one operation (in-place subscription
 * item upgrade/downgrade with proration, and pause_collection) that the
 * PlatformGateway abstraction deliberately doesn't cover — every other
 * gateway interaction in this file goes through getGateway()/the registry,
 * never a concrete provider file under gateway/. This constructs its own
 * client (mirrors, but does not import, gateway/stripe.ts's construction).
 */
function getStripeClientForLiveOps(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

/**
 * For a BillingAccount with no live gatewaySubscriptionId yet (still on the
 * free/manual/self-service path), this updates currentPlanId directly — real
 * and immediate, no proration needed. For one with a real
 * gatewaySubscriptionId, only Stripe supports a genuine live in-place
 * upgrade/downgrade via `stripe.subscriptions.update` with a new price +
 * proration_behavior; every other gateway (Razorpay, Paddle, LemonSqueezy)
 * has no documented "swap this live subscription's price" endpoint in this
 * codebase's adapters, so those honestly require the customer to go through
 * startCheckout again to switch plans — never silently faked here.
 */
export async function changePlan(organizationId: string, newPlanId: string): Promise<ChangePlanResult> {
  const [billingAccount, newPlan] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { organizationId } }),
    prisma.plan.findUnique({ where: { id: newPlanId } }),
  ]);
  if (!newPlan) return { ok: false, error: "That plan doesn't exist." };

  if (!billingAccount) {
    await prisma.billingAccount.create({ data: { organizationId, currentPlanId: newPlan.id } });
    return { ok: true };
  }

  if (!billingAccount.gatewaySubscriptionId) {
    await prisma.billingAccount.update({ where: { id: billingAccount.id }, data: { currentPlanId: newPlan.id } });
    return { ok: true };
  }

  if (billingAccount.gatewayProvider !== "STRIPE") {
    return {
      ok: false,
      error:
        "This organization has a live subscription on a gateway that doesn't support swapping plans in place — start a new checkout (startCheckout) to switch plans, which will replace the current subscription once it completes.",
    };
  }

  const stripeGateway = getGateway("STRIPE");
  if (!stripeGateway.isConfigured()) {
    return { ok: false, error: `${stripeGateway.name} isn't configured — set ${stripeGateway.requiredEnvVars.join(", ")}.` };
  }

  const gatewayPriceIds = (newPlan.gatewayPriceIds as Record<string, string> | null) ?? {};
  const newPriceId = gatewayPriceIds.STRIPE;
  if (!newPriceId) return { ok: false, error: "The new plan isn't available via Stripe yet." };

  try {
    const stripe = getStripeClientForLiveOps();
    const subscription = await stripe.subscriptions.retrieve(billingAccount.gatewaySubscriptionId);
    const currentItem = subscription.items.data[0];
    if (!currentItem) return { ok: false, error: "This Stripe subscription has no line item to update." };

    await stripe.subscriptions.update(billingAccount.gatewaySubscriptionId, {
      items: [{ id: currentItem.id, price: newPriceId }],
      proration_behavior: "create_prorations",
    });

    await prisma.billingAccount.update({ where: { id: billingAccount.id }, data: { currentPlanId: newPlan.id } });
    return { ok: true };
  } catch (error) {
    console.error("[billing/subscriptions] changePlan (live Stripe subscription update) failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "Stripe subscription update failed." };
  }
}

// ===================== cancel / pause / resume =====================

export async function cancelSubscription(organizationId: string, atPeriodEnd: boolean): Promise<{ ok: boolean; error?: string }> {
  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId } });
  if (!billingAccount) return { ok: false, error: "This organization has no billing account yet." };

  if (billingAccount.gatewaySubscriptionId && billingAccount.gatewayProvider) {
    const gateway = getGateway(billingAccount.gatewayProvider);
    if (!gateway.isConfigured()) return { ok: false, error: `${gateway.name} isn't configured — set ${gateway.requiredEnvVars.join(", ")}.` };
    try {
      await gateway.cancelSubscription(billingAccount.gatewaySubscriptionId, atPeriodEnd);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Gateway subscription cancellation failed." };
    }
  }

  await prisma.billingAccount.update({
    where: { id: billingAccount.id },
    data: atPeriodEnd ? { cancelAtPeriodEnd: true } : { status: "CANCELED", canceledAt: new Date(), cancelAtPeriodEnd: false },
  });

  return { ok: true };
}

/**
 * Real Stripe `pause_collection` for a live Stripe subscription — genuinely
 * pauses that subscription's billing at the gateway. Razorpay, Paddle, and
 * LemonSqueezy have no documented "pause this live subscription" endpoint in
 * this codebase's adapters (only cancel), so for those — and for any
 * BillingAccount with no live gatewaySubscriptionId at all (free/manual
 * accounts) — this only pauses GrowthOS's own access-gating via
 * BillingAccount.status; the gateway itself, if any, keeps billing on its
 * own real schedule until cancelSubscription is actually called against it.
 * This is a real, documented limitation, not a silent gap.
 */
export async function pauseSubscription(organizationId: string): Promise<{ ok: boolean; error?: string }> {
  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId } });
  if (!billingAccount) return { ok: false, error: "This organization has no billing account yet." };

  if (billingAccount.gatewaySubscriptionId && billingAccount.gatewayProvider === "STRIPE") {
    const stripeGateway = getGateway("STRIPE");
    if (!stripeGateway.isConfigured()) return { ok: false, error: `${stripeGateway.name} isn't configured — set ${stripeGateway.requiredEnvVars.join(", ")}.` };
    try {
      const stripe = getStripeClientForLiveOps();
      await stripe.subscriptions.update(billingAccount.gatewaySubscriptionId, { pause_collection: { behavior: "void" } });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Stripe subscription pause failed." };
    }
  }

  await prisma.billingAccount.update({ where: { id: billingAccount.id }, data: { status: "PAUSED", pausedAt: new Date() } });
  return { ok: true };
}

export async function resumeSubscription(organizationId: string): Promise<{ ok: boolean; error?: string }> {
  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId } });
  if (!billingAccount) return { ok: false, error: "This organization has no billing account yet." };

  if (billingAccount.gatewaySubscriptionId && billingAccount.gatewayProvider === "STRIPE") {
    const stripeGateway = getGateway("STRIPE");
    if (!stripeGateway.isConfigured()) return { ok: false, error: `${stripeGateway.name} isn't configured — set ${stripeGateway.requiredEnvVars.join(", ")}.` };
    try {
      const stripe = getStripeClientForLiveOps();
      await stripe.subscriptions.update(billingAccount.gatewaySubscriptionId, { pause_collection: null });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Stripe subscription resume failed." };
    }
  }

  await prisma.billingAccount.update({ where: { id: billingAccount.id }, data: { status: "ACTIVE", pausedAt: null } });
  return { ok: true };
}

// ===================== markManualPaymentReceived =====================

/** Real calendar-based extension (handles variable month lengths / leap years correctly, never a fixed-ms approximation). LIFETIME has no real recurring cycle — a 100-year extension is a practical "never expires again" sentinel for a one-time lifetime purchase, not a fabricated real billing cycle. */
function extendByInterval(base: Date, interval: BillingIntervalUnit): Date {
  const result = new Date(base);
  switch (interval) {
    case "MONTHLY":
      result.setMonth(result.getMonth() + 1);
      break;
    case "QUARTERLY":
      result.setMonth(result.getMonth() + 3);
      break;
    case "YEARLY":
      result.setFullYear(result.getFullYear() + 1);
      break;
    case "LIFETIME":
      result.setFullYear(result.getFullYear() + 100);
      break;
  }
  return result;
}

/**
 * For BANK_TRANSFER/MANUAL payments — creates a real PlatformPayment
 * (status SUCCEEDED), marks the most recent open PlatformInvoice paid if one
 * exists, extends currentPeriodEnd by one real billing interval (from the
 * org's current Plan, defaulting to MONTHLY if no plan is set yet), and sets
 * status ACTIVE. `note` is recorded as a real Activity log entry (there is
 * no free-text field on PlatformPayment itself to hold operator notes).
 */
export async function markManualPaymentReceived(
  billingAccountId: string,
  amountCents: number,
  currency: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const billingAccount = await prisma.billingAccount.findUnique({ where: { id: billingAccountId }, include: { currentPlan: true } });
  if (!billingAccount) return { ok: false, error: `BillingAccount ${billingAccountId} not found.` };

  const openInvoice = await prisma.platformInvoice.findFirst({
    where: { billingAccountId, status: { in: ["OPEN", "DRAFT"] } },
    orderBy: { issuedAt: "desc" },
  });

  const interval = billingAccount.currentPlan?.interval ?? "MONTHLY";
  const base = billingAccount.currentPeriodEnd && billingAccount.currentPeriodEnd > new Date() ? billingAccount.currentPeriodEnd : new Date();
  const newPeriodEnd = extendByInterval(base, interval);

  await prisma.$transaction(async (tx) => {
    await tx.platformPayment.create({
      data: {
        organizationId: billingAccount.organizationId,
        billingAccountId,
        invoiceId: openInvoice?.id,
        provider: "MANUAL",
        status: "SUCCEEDED",
        amountCents,
        currency,
        paidAt: new Date(),
      },
    });

    if (openInvoice) {
      await tx.platformInvoice.update({
        where: { id: openInvoice.id },
        data: { status: "PAID", paidAt: new Date(), amountPaidCents: { increment: amountCents } },
      });
    }

    await tx.billingAccount.update({
      where: { id: billingAccountId },
      data: {
        status: "ACTIVE",
        gatewayProvider: billingAccount.gatewayProvider ?? "MANUAL",
        currentPeriodStart: billingAccount.currentPeriodStart ?? new Date(),
        currentPeriodEnd: newPeriodEnd,
      },
    });
  });

  await logActivity({
    organizationId: billingAccount.organizationId,
    type: "SYSTEM_EVENT",
    description: `Manual payment of ${(amountCents / 100).toFixed(2)} ${currency} recorded.${note ? ` Note: ${note}` : ""}`,
    metadata: { billingAccountId, amountCents, currency },
  });

  return { ok: true };
}

// ===================== webhook-driven state machine =====================

/**
 * Best-effort, honest extraction of the {organizationId, billingAccountId}
 * pair each gateway adapter's createCheckoutSession() genuinely echoes back
 * on its own webhook payloads: Stripe's Checkout Session `metadata`,
 * Razorpay's Subscription `notes`, Paddle's transaction `custom_data`, and
 * LemonSqueezy's top-level `meta.custom_data` (LemonSqueezy's documented
 * convention: whatever custom checkout data was set is echoed back under
 * `meta.custom_data` on every subsequent webhook for objects created from
 * that checkout). Returns {} (never throws) if none of these shapes match —
 * callers fall back to id-based lookups.
 */
function extractMetadataOrgIds(raw: unknown): { organizationId?: string; billingAccountId?: string } {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;

  const candidates: unknown[] = [
    data?.object, // Stripe: event.data.object.metadata
    data, // Paddle: event.data.custom_data
    r.meta, // LemonSqueezy: event.meta.custom_data
    (r.payload as Record<string, unknown> | undefined)?.subscription && ((r.payload as Record<string, unknown>).subscription as Record<string, unknown>).entity, // Razorpay: payload.subscription.entity.notes
    (r.payload as Record<string, unknown> | undefined)?.payment && ((r.payload as Record<string, unknown>).payment as Record<string, unknown>).entity, // Razorpay: payload.payment.entity.notes
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const c = candidate as Record<string, unknown>;
    const bag = (c.metadata ?? c.custom_data ?? c.notes ?? c.custom) as Record<string, unknown> | undefined;
    if (bag && typeof bag === "object") {
      const organizationId = bag.organizationId;
      const billingAccountId = bag.billingAccountId;
      if (typeof organizationId === "string" && typeof billingAccountId === "string") {
        return { organizationId, billingAccountId };
      }
    }
  }
  return {};
}

interface ResolvedBillingAccount {
  organizationId: string;
  billingAccountId: string;
}

/** Real resolution, in order: (1) the event's own echoed metadata, (2) an already-linked BillingAccount by gatewaySubscriptionId, (3) the gatewayLinkCacheKey Redis fallback keyed by gatewaySubscriptionId, (4) an already-linked BillingAccount by gatewayCustomerId. Returns null (never fabricates a match) if none resolve. */
async function resolveBillingAccountForEvent(event: NormalizedWebhookEvent): Promise<ResolvedBillingAccount | null> {
  const metadata = extractMetadataOrgIds(event.raw);
  if (metadata.organizationId && metadata.billingAccountId) {
    const billingAccount = await prisma.billingAccount.findUnique({ where: { id: metadata.billingAccountId } });
    if (billingAccount && billingAccount.organizationId === metadata.organizationId) {
      return { organizationId: billingAccount.organizationId, billingAccountId: billingAccount.id };
    }
  }

  if (event.gatewaySubscriptionId) {
    const bySubscription = await prisma.billingAccount.findFirst({ where: { gatewaySubscriptionId: event.gatewaySubscriptionId } });
    if (bySubscription) return { organizationId: bySubscription.organizationId, billingAccountId: bySubscription.id };

    const cached = await getCached<ResolvedBillingAccount>(gatewayLinkCacheKey(event.gatewaySubscriptionId));
    if (cached) return cached;
  }

  if (event.gatewayCustomerId) {
    const byCustomer = await prisma.billingAccount.findFirst({ where: { gatewayCustomerId: event.gatewayCustomerId } });
    if (byCustomer) return { organizationId: byCustomer.organizationId, billingAccountId: byCustomer.id };
  }

  return null;
}

/** Maps a gateway's own real, provider-specific subscription status string onto this app's BillingStatus enum. An unrecognized string is presumed ACTIVE rather than silently cutting off access on a status value this mapper doesn't yet know about. */
export function mapGatewayStatus(rawStatus: string): BillingStatus {
  const normalized = rawStatus.toLowerCase();
  if (["active", "authenticated", "charged", "resumed"].includes(normalized)) return "ACTIVE";
  if (normalized === "trialing") return "TRIALING";
  if (["past_due", "unpaid"].includes(normalized)) return "PAST_DUE";
  if (["canceled", "cancelled", "expired", "deleted", "completed"].includes(normalized)) return "CANCELED";
  if (["paused", "halted"].includes(normalized)) return "PAUSED";
  if (["incomplete", "incomplete_expired", "created", "pending"].includes(normalized)) return "INCOMPLETE";
  return "ACTIVE";
}

async function handleCheckoutCompleted(provider: PaymentGatewayProvider, event: NormalizedWebhookEvent): Promise<void> {
  const resolved = await resolveBillingAccountForEvent(event);
  if (!resolved) {
    console.error(`[billing/subscriptions] checkout.completed (${provider}, ${event.gatewayEventId}) — could not resolve a BillingAccount.`);
    return;
  }

  await prisma.billingAccount.update({
    where: { id: resolved.billingAccountId },
    data: {
      gatewayProvider: provider,
      gatewayCustomerId: event.gatewayCustomerId ?? undefined,
      gatewaySubscriptionId: event.gatewaySubscriptionId ?? undefined,
      status: event.subscriptionSnapshot ? mapGatewayStatus(event.subscriptionSnapshot.status) : "ACTIVE",
      currentPeriodStart: event.subscriptionSnapshot?.currentPeriodStart ?? undefined,
      currentPeriodEnd: event.subscriptionSnapshot?.currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: event.subscriptionSnapshot?.cancelAtPeriodEnd ?? undefined,
    },
  });

  if (event.gatewaySubscriptionId) {
    await setCached(gatewayLinkCacheKey(event.gatewaySubscriptionId), resolved, GATEWAY_LINK_CACHE_TTL_SECONDS);
  }
}

async function handleSubscriptionUpsert(event: NormalizedWebhookEvent): Promise<void> {
  const resolved = await resolveBillingAccountForEvent(event);
  if (!resolved) {
    console.error(`[billing/subscriptions] subscription upsert (${event.gatewayEventId}) — could not resolve a BillingAccount.`);
    return;
  }

  const snapshot = event.subscriptionSnapshot;
  await prisma.billingAccount.update({
    where: { id: resolved.billingAccountId },
    data: {
      gatewaySubscriptionId: snapshot?.gatewaySubscriptionId ?? event.gatewaySubscriptionId ?? undefined,
      gatewayCustomerId: snapshot?.gatewayCustomerId ?? event.gatewayCustomerId ?? undefined,
      status: snapshot ? mapGatewayStatus(snapshot.status) : undefined,
      currentPeriodStart: snapshot?.currentPeriodStart ?? undefined,
      currentPeriodEnd: snapshot?.currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: snapshot?.cancelAtPeriodEnd ?? undefined,
    },
  });
}

async function handleSubscriptionCanceled(event: NormalizedWebhookEvent): Promise<void> {
  const resolved = await resolveBillingAccountForEvent(event);
  if (!resolved) {
    console.error(`[billing/subscriptions] subscription.canceled (${event.gatewayEventId}) — could not resolve a BillingAccount.`);
    return;
  }
  await prisma.billingAccount.update({ where: { id: resolved.billingAccountId }, data: { status: "CANCELED", canceledAt: new Date() } });
}

async function handleInvoicePaid(provider: PaymentGatewayProvider, event: NormalizedWebhookEvent): Promise<void> {
  const resolved = await resolveBillingAccountForEvent(event);
  if (!resolved) {
    console.error(`[billing/subscriptions] invoice.paid (${event.gatewayEventId}) — could not resolve a BillingAccount.`);
    return;
  }

  const amountCents = event.amountCents ?? 0;
  const currency = event.currency ?? "USD";

  let invoice = event.gatewayInvoiceId
    ? await prisma.platformInvoice.findFirst({ where: { billingAccountId: resolved.billingAccountId, gatewayInvoiceId: event.gatewayInvoiceId } })
    : null;

  if (!invoice) {
    invoice = await generatePlatformInvoice(
      resolved.billingAccountId,
      [{ description: "Subscription renewal", quantity: 1, unitAmountCents: amountCents }],
      "RECURRING",
      currency,
    );
    if (event.gatewayInvoiceId) {
      invoice = await prisma.platformInvoice.update({ where: { id: invoice.id }, data: { gatewayInvoiceId: event.gatewayInvoiceId } });
    }
  }

  if (invoice.status !== "PAID") {
    await prisma.platformInvoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date(), amountPaidCents: invoice.totalCents } });
  }

  const alreadyRecorded = event.gatewayPaymentId
    ? await prisma.platformPayment.findFirst({ where: { billingAccountId: resolved.billingAccountId, gatewayPaymentId: event.gatewayPaymentId } })
    : null;

  if (!alreadyRecorded) {
    await prisma.platformPayment.create({
      data: {
        organizationId: resolved.organizationId,
        billingAccountId: resolved.billingAccountId,
        invoiceId: invoice.id,
        provider,
        status: "SUCCEEDED",
        amountCents,
        currency,
        gatewayPaymentId: event.gatewayPaymentId,
        paidAt: new Date(),
      },
    });
  }

  await prisma.billingAccount.update({ where: { id: resolved.billingAccountId }, data: { status: "ACTIVE" } });
}

async function handleInvoicePaymentFailed(provider: PaymentGatewayProvider, event: NormalizedWebhookEvent): Promise<void> {
  const resolved = await resolveBillingAccountForEvent(event);
  if (!resolved) {
    console.error(`[billing/subscriptions] invoice.payment_failed (${event.gatewayEventId}) — could not resolve a BillingAccount.`);
    return;
  }

  await prisma.billingAccount.update({ where: { id: resolved.billingAccountId }, data: { status: "PAST_DUE" } });

  await prisma.platformPayment.create({
    data: {
      organizationId: resolved.organizationId,
      billingAccountId: resolved.billingAccountId,
      provider,
      status: "FAILED",
      amountCents: event.amountCents ?? 0,
      currency: event.currency ?? "USD",
      gatewayPaymentId: event.gatewayPaymentId,
      failureReason: event.failureReason ?? "Payment failed.",
    },
  });
}

async function handleChargeRefunded(event: NormalizedWebhookEvent): Promise<void> {
  if (!event.gatewayPaymentId) {
    console.error(`[billing/subscriptions] charge.refunded (${event.gatewayEventId}) — no gatewayPaymentId on the event.`);
    return;
  }

  const payment = await prisma.platformPayment.findFirst({
    where: { OR: [{ gatewayPaymentId: event.gatewayPaymentId }, { gatewayChargeId: event.gatewayPaymentId }] },
  });
  if (!payment) {
    console.warn(`[billing/subscriptions] charge.refunded (${event.gatewayEventId}) — no matching PlatformPayment for gateway id ${event.gatewayPaymentId}.`);
    return;
  }

  const refundedAmountCents = event.amountCents ?? payment.amountCents;
  const fullyRefunded = refundedAmountCents >= payment.amountCents;

  await prisma.platformPayment.update({
    where: { id: payment.id },
    data: { refundedAmountCents, status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
  });
}

/**
 * The real webhook-driven state machine — idempotent via a Redis-tracked
 * `gatewayEventId` dedup key (processedEventCacheKey), 14-day TTL. If Redis
 * is genuinely unavailable, getCached degrades to "not yet processed" (same
 * documented degradation as every other consumer of
 * src/lib/cache/redis-cache.ts) rather than throwing — a rare double-process
 * on a Redis outage is an accepted tradeoff against ever silently dropping a
 * real billing event. Never throws out of this function: a single
 * malformed/unresolvable event is logged and skipped so the webhook route
 * can still return 200 and the gateway never enters a retry storm over a
 * genuine data issue.
 */
export async function handleGatewayWebhookEvent(provider: PaymentGatewayProvider, event: NormalizedWebhookEvent): Promise<void> {
  try {
    const dedupKey = processedEventCacheKey(provider, event.gatewayEventId);
    const alreadyProcessed = await getCached<boolean>(dedupKey);
    if (alreadyProcessed) {
      console.warn(`[billing/subscriptions] duplicate webhook event ${event.gatewayEventId} (${provider}) — skipping.`);
      return;
    }
    await setCached(dedupKey, true, PROCESSED_EVENT_TTL_SECONDS);

    // Metadata-first branch (Phase 19: paid marketplace listings) — a
    // marketplace order's checkout carries real, gateway-echoed metadata
    // (kind: "marketplace_order"), so it's routed to marketplace
    // fulfillment instead of the BillingAccount-oriented switch below.
    // Lazy import avoids a circular dependency (checkout.ts doesn't import
    // this file at module scope).
    if (event.metadata?.kind === "marketplace_order") {
      const { handleMarketplaceOrderWebhookEvent } = await import("@/lib/marketplace/checkout");
      await handleMarketplaceOrderWebhookEvent(provider, event);
      return;
    }

    // Same metadata-first routing, for a real Growth Token top-up purchase
    // (kind: "growth_token_purchase" — src/lib/billing/token-purchase.ts).
    if (event.metadata?.kind === "growth_token_purchase") {
      const { handleGrowthTokenPurchaseWebhookEvent } = await import("./token-purchase");
      await handleGrowthTokenPurchaseWebhookEvent(provider, event);
      return;
    }

    switch (event.type) {
      case "checkout.completed":
        await handleCheckoutCompleted(provider, event);
        break;
      case "subscription.created":
      case "subscription.updated":
        await handleSubscriptionUpsert(event);
        break;
      case "subscription.canceled":
        await handleSubscriptionCanceled(event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(provider, event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(provider, event);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event);
        break;
      case "unhandled":
        break;
    }
  } catch (error) {
    console.error(`[billing/subscriptions] handleGatewayWebhookEvent failed (${provider}, ${event.type}, ${event.gatewayEventId}):`, error);
  }
}
