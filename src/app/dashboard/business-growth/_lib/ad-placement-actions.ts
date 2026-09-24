"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import type { ListingAdPlacementType } from "@/generated/prisma/client";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

const PLACEMENT_DURATION_DAYS = 7;

async function requireEditorMembership(): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedListing(organizationId: string, listingId: string) {
  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== organizationId) return null;
  return listing;
}

/**
 * Buys a real 7-day dedicated ad slot — same atomic spend-then-create
 * transaction shape as featureListing/publishListing in listing-actions.ts,
 * so a failed/insufficient spend can never leave a placement live for free.
 * Only a PUBLISHED listing can advertise (nothing real to click through to
 * otherwise).
 */
export async function purchaseAdPlacement(listingId: string, placement: ListingAdPlacementType): Promise<ActionResult<{ remainingTokens?: number; endsAt?: Date }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  if (listing.status !== "PUBLISHED") return { ok: false, error: "Publish this listing before buying an ad placement." };

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + PLACEMENT_DURATION_DAYS * 24 * 60 * 60_000);

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "AD_PLACEMENT_PURCHASE", {
        referenceType: "BusinessListing",
        referenceId: listingId,
        context: "business-growth:purchase-ad-placement",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to buy this ad placement.");

      await tx.listingAdPlacement.create({ data: { businessListingId: listingId, placement, startsAt, endsAt } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_listing.ad_placement_purchased",
      metadata: { listingId, placement, tokensCost: GROWTH_TOKEN_COST.AD_PLACEMENT_PURCHASE, endsAt },
    });

    revalidatePath(`/dashboard/business-growth/${listingId}/advertising`);
    return { ok: true, data: { remainingTokens, endsAt } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not buy this ad placement." };
  }
}
