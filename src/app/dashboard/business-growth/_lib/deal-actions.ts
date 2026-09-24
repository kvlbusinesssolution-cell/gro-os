"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { businessDealInputSchema, type BusinessDealInput } from "@/lib/validations/listings";
import type { MembershipRole } from "@/generated/prisma/client";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

const EDITOR_ROLES = new Set<MembershipRole>(["OWNER", "ADMIN", "MANAGER", "MARKETING"]);

async function requireEditorMembership(): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!EDITOR_ROLES.has(membership.role)) return { ok: false, error: "Only an Owner, Admin, Manager, or Marketing member can manage deals." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedListing(organizationId: string, listingId: string) {
  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== organizationId) return null;
  return listing;
}

async function resolveOwnedDeal(organizationId: string, dealId: string) {
  const deal = await prisma.businessDeal.findUnique({ where: { id: dealId }, include: { businessListing: true } });
  if (!deal || deal.businessListing.organizationId !== organizationId) return null;
  return deal;
}

export async function createDeal(listingId: string, input: BusinessDealInput): Promise<ActionResult<{ id: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const parsed = businessDealInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the deal details." };
  const data = parsed.data;

  const deal = await prisma.businessDeal.create({
    data: {
      businessListingId: listingId,
      title: data.title,
      description: data.description || null,
      discountLabel: data.discountLabel || null,
      termsAndConditions: data.termsAndConditions || null,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
    },
  });

  revalidatePath(`/dashboard/business-growth/${listingId}/deals`);
  return { ok: true, data: { id: deal.id } };
}

/** Editing a DRAFT or a live deal is free — only publishDeal spends Growth Tokens. */
export async function updateDeal(dealId: string, input: BusinessDealInput): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const deal = await resolveOwnedDeal(access.organizationId, dealId);
  if (!deal) return { ok: false, error: "Deal not found." };

  const parsed = businessDealInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the deal details." };
  const data = parsed.data;

  await prisma.businessDeal.update({
    where: { id: dealId },
    data: {
      title: data.title,
      description: data.description || null,
      discountLabel: data.discountLabel || null,
      termsAndConditions: data.termsAndConditions || null,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
    },
  });

  revalidatePath(`/dashboard/business-growth/${deal.businessListingId}/deals`);
  if (deal.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${deal.businessListing.slug}`);
  return { ok: true };
}

/** The ONLY place a deal's Growth Token cost is charged — same transaction-composed pattern as publishListing. */
export async function publishDeal(dealId: string): Promise<ActionResult<{ remainingTokens?: number }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const deal = await resolveOwnedDeal(access.organizationId, dealId);
  if (!deal) return { ok: false, error: "Deal not found." };
  if (deal.status === "PUBLISHED") return { ok: true, data: {} };

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "DEAL_POST", {
        referenceType: "BusinessDeal",
        referenceId: dealId,
        context: "business-growth:publish-deal",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to post this deal.");

      await tx.businessDeal.update({ where: { id: dealId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_deal.published",
      metadata: { dealId, tokensCost: GROWTH_TOKEN_COST.DEAL_POST },
    });

    revalidatePath(`/dashboard/business-growth/${deal.businessListingId}/deals`);
    revalidatePath(`/listings/${deal.businessListing.slug}`);
    return { ok: true, data: { remainingTokens } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not post this deal." };
  }
}

export async function archiveDeal(dealId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const deal = await resolveOwnedDeal(access.organizationId, dealId);
  if (!deal) return { ok: false, error: "Deal not found." };

  await prisma.businessDeal.update({ where: { id: dealId }, data: { status: "ARCHIVED" } });

  revalidatePath(`/dashboard/business-growth/${deal.businessListingId}/deals`);
  if (deal.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${deal.businessListing.slug}`);
  return { ok: true };
}
