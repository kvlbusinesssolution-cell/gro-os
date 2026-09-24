"use server";

import { auth } from "@/auth";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { logAudit } from "@/lib/audit";
import { getAppBaseUrl } from "@/lib/outreach/tracking";
import { startGrowthTokenPurchase } from "@/lib/billing/token-purchase";

export interface BuyGrowthTokensActionResult {
  ok: boolean;
  error?: string;
  checkoutUrl?: string;
}

const BILLING_PATH = "/dashboard/billing";

/** Resolves real absolute success/cancel URLs back to this page and hands off to the real gateway checkout-session creator (src/lib/billing/token-purchase.ts). Any ACTIVE member can buy tokens for their own org — unlike subscription changes, this never reduces access or costs the org anything unexpected, so it isn't restricted to OWNER/ADMIN. */
export async function buyGrowthTokensAction(packageId: string): Promise<BuyGrowthTokensActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const baseUrl = getAppBaseUrl();

  try {
    const result = await startGrowthTokenPurchase({
      organizationId: membership.organizationId,
      buyerUserId: userId,
      packageId,
      successUrl: `${baseUrl}${BILLING_PATH}?tokenPurchaseSuccess=1`,
      cancelUrl: `${baseUrl}${BILLING_PATH}?tokenPurchaseCanceled=1`,
    });

    if (result.ok) {
      await logAudit({ userId, organizationId: membership.organizationId, action: "billing.growth_token_purchase.checkout_started", metadata: { packageId } });
    }
    return result;
  } catch (error) {
    console.error("[billing/tokens] buyGrowthTokensAction failed:", error);
    return { ok: false, error: "Could not start checkout. Please try again." };
  }
}
