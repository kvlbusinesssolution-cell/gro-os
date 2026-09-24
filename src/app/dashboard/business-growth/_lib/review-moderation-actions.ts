"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
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
  if (!EDITOR_ROLES.has(membership.role)) return { ok: false, error: "Only an Owner, Admin, Manager, or Marketing member can moderate reviews." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedReview(organizationId: string, reviewId: string) {
  const review = await prisma.businessReview.findUnique({ where: { id: reviewId }, include: { businessListing: true } });
  if (!review || review.businessListing.organizationId !== organizationId) return null;
  return review;
}

/** Recomputes the listing's denormalized averageRating/reviewCount from real APPROVED rows only — never trust the counters as a source of truth on their own. */
async function recomputeListingRating(businessListingId: string): Promise<void> {
  const approved = await prisma.businessReview.findMany({ where: { businessListingId, status: "APPROVED" }, select: { rating: true } });
  const reviewCount = approved.length;
  const averageRating = reviewCount === 0 ? 0 : approved.reduce((sum, r) => sum + r.rating, 0) / reviewCount;
  await prisma.businessListing.update({ where: { id: businessListingId }, data: { averageRating, reviewCount } });
}

export async function approveReview(reviewId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const review = await resolveOwnedReview(access.organizationId, reviewId);
  if (!review) return { ok: false, error: "Review not found." };

  await prisma.businessReview.update({ where: { id: reviewId }, data: { status: "APPROVED", moderatedByUserId: access.userId, moderatedAt: new Date() } });
  await recomputeListingRating(review.businessListingId);
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_review.approved", metadata: { reviewId } });

  revalidatePath(`/dashboard/business-growth/${review.businessListingId}/reviews`);
  if (review.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${review.businessListing.slug}`);
  return { ok: true };
}

export async function rejectReview(reviewId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const review = await resolveOwnedReview(access.organizationId, reviewId);
  if (!review) return { ok: false, error: "Review not found." };

  await prisma.businessReview.update({ where: { id: reviewId }, data: { status: "REJECTED", moderatedByUserId: access.userId, moderatedAt: new Date() } });
  // A previously-approved review being reverted to REJECTED must also drop
  // out of the rating — recompute regardless of prior status.
  await recomputeListingRating(review.businessListingId);
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_review.rejected", metadata: { reviewId } });

  revalidatePath(`/dashboard/business-growth/${review.businessListingId}/reviews`);
  if (review.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${review.businessListing.slug}`);
  return { ok: true };
}

/** Public reply from the business owner — independent of approve/reject; can be added to an APPROVED review at any time without re-triggering moderation. */
export async function replyToReview(reviewId: string, body: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Write a reply before submitting." };
  if (trimmed.length > 2000) return { ok: false, error: "Reply is too long." };

  const review = await resolveOwnedReview(access.organizationId, reviewId);
  if (!review) return { ok: false, error: "Review not found." };

  await prisma.businessReview.update({ where: { id: reviewId }, data: { ownerReplyBody: trimmed, ownerRepliedAt: new Date() } });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_review.replied", metadata: { reviewId } });

  revalidatePath(`/dashboard/business-growth/${review.businessListingId}/reviews`);
  if (review.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${review.businessListing.slug}`);
  return { ok: true };
}
