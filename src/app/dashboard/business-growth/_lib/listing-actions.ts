"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { LISTING_FEATURE_DURATION_DAYS } from "@/lib/billing/token-pricing";
import { generateUniqueListingSlug } from "@/lib/listings/slug";
import { saveListingPhoto, removeListingPhoto } from "@/lib/listings/photos";
import { businessListingInputSchema, type BusinessListingInput } from "@/lib/validations/listings";
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
  if (!EDITOR_ROLES.has(membership.role)) return { ok: false, error: "Only an Owner, Admin, Manager, or Marketing member can manage business listings." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedListing(organizationId: string, listingId: string) {
  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== organizationId) return null;
  return listing;
}

/** Draft creation is free — only publishing (see publishListing below) spends Growth Tokens. */
export async function createListing(input: BusinessListingInput): Promise<ActionResult<{ id: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const parsed = businessListingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the listing details." };
  const data = parsed.data;

  const slug = await generateUniqueListingSlug(prisma, data.businessName, data.city);

  const listing = await prisma.businessListing.create({
    data: {
      organizationId: access.organizationId,
      slug,
      businessName: data.businessName,
      tagline: data.tagline || null,
      description: data.description || null,
      category: data.category,
      categories: data.categories ?? [],
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 || null,
      city: data.city,
      state: data.state || null,
      postalCode: data.postalCode || null,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      phone: data.phone || null,
      whatsappNumber: data.whatsappNumber || null,
      contactEmail: data.contactEmail || null,
      website: data.website || null,
      priceRange: data.priceRange || null,
      openingHours: data.openingHours ?? undefined,
      videoUrl: data.videoUrl || null,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      createdByUserId: access.userId,
    },
  });

  revalidatePath("/dashboard/business-growth");
  return { ok: true, data: { id: listing.id } };
}

/** Editing a DRAFT or an already-PUBLISHED listing is free — never re-charges Growth Tokens; only the DRAFT/UNPUBLISHED -> PUBLISHED transition does (publishListing). */
export async function updateListing(listingId: string, input: BusinessListingInput): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const parsed = businessListingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the listing details." };
  const data = parsed.data;

  await prisma.businessListing.update({
    where: { id: listingId },
    data: {
      businessName: data.businessName,
      tagline: data.tagline || null,
      description: data.description || null,
      category: data.category,
      categories: data.categories ?? undefined,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 || null,
      city: data.city,
      state: data.state || null,
      postalCode: data.postalCode || null,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      phone: data.phone || null,
      whatsappNumber: data.whatsappNumber || null,
      contactEmail: data.contactEmail || null,
      website: data.website || null,
      priceRange: data.priceRange || null,
      openingHours: data.openingHours ?? undefined,
      videoUrl: data.videoUrl || null,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
    },
  });

  revalidatePath("/dashboard/business-growth");
  revalidatePath(`/dashboard/business-growth/${listingId}`);
  if (listing.status === "PUBLISHED") revalidatePath(`/listings/${listing.slug}`);
  return { ok: true };
}

/**
 * The ONLY place a listing's Growth Token cost is charged — composes the
 * spend + the status flip in one transaction (via spendGrowthTokens's `tx`
 * option) so a failed/insufficient spend can never leave a listing
 * PUBLISHED, and two concurrent "Publish" clicks can never both succeed off
 * a balance that only covers one.
 */
export async function publishListing(listingId: string): Promise<ActionResult<{ remainingTokens?: number }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  if (listing.status === "PUBLISHED") return { ok: true, data: {} };

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "LISTING_PUBLISH", {
        referenceType: "BusinessListing",
        referenceId: listingId,
        context: "business-growth:publish-listing",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to publish this listing.");

      await tx.businessListing.update({ where: { id: listingId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_listing.published",
      metadata: { listingId, tokensCost: GROWTH_TOKEN_COST.LISTING_PUBLISH },
    });

    revalidatePath("/dashboard/business-growth");
    revalidatePath(`/dashboard/business-growth/${listingId}`);
    revalidatePath(`/listings/${listing.slug}`);
    return { ok: true, data: { remainingTokens } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not publish this listing." };
  }
}

/**
 * Self-serve boosted placement — same atomic spend-then-mutate transaction
 * shape as publishListing above, just a different status flip. Only a
 * PUBLISHED listing can be boosted (an unpublished one has no search
 * position to boost). Re-featuring an already-featured listing simply
 * extends featuredUntil another LISTING_FEATURE_DURATION_DAYS from now,
 * rather than stacking — a merchant clicking twice shouldn't be charged for
 * something that silently does nothing extra... it DOES do something extra
 * (renews the boost), so the charge is legitimate.
 */
export async function featureListing(listingId: string): Promise<ActionResult<{ remainingTokens?: number; featuredUntil?: Date }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };
  if (listing.status !== "PUBLISHED") return { ok: false, error: "Publish this listing before featuring it." };

  const featuredUntil = new Date();
  featuredUntil.setDate(featuredUntil.getDate() + LISTING_FEATURE_DURATION_DAYS);

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "LISTING_FEATURE", {
        referenceType: "BusinessListing",
        referenceId: listingId,
        context: "business-growth:feature-listing",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to feature this listing.");

      await tx.businessListing.update({ where: { id: listingId }, data: { isFeatured: true, featuredUntil } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_listing.featured",
      metadata: { listingId, tokensCost: GROWTH_TOKEN_COST.LISTING_FEATURE, featuredUntil },
    });

    revalidatePath("/dashboard/business-growth");
    revalidatePath(`/dashboard/business-growth/${listingId}`);
    revalidatePath(`/listings/${listing.slug}`);
    revalidatePath("/listings");
    return { ok: true, data: { remainingTokens, featuredUntil } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not feature this listing." };
  }
}

export async function unpublishListing(listingId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  await prisma.businessListing.update({ where: { id: listingId }, data: { status: "UNPUBLISHED" } });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_listing.unpublished", metadata: { listingId } });

  revalidatePath("/dashboard/business-growth");
  revalidatePath(`/dashboard/business-growth/${listingId}`);
  revalidatePath(`/listings/${listing.slug}`);
  return { ok: true };
}

export async function deleteListing(listingId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const photos = await prisma.businessListingPhoto.findMany({ where: { businessListingId: listingId }, select: { storageKey: true } });
  await prisma.businessListing.delete({ where: { id: listingId } });
  await Promise.all(photos.map((p) => removeListingPhoto(p.storageKey).catch(() => {})));

  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_listing.deleted", metadata: { listingId } });

  revalidatePath("/dashboard/business-growth");
  return { ok: true };
}

export async function addListingPhoto(listingId: string, file: File, caption?: string, is360?: boolean): Promise<ActionResult<{ id: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  let upload;
  try {
    upload = await saveListingPhoto(listingId, file);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not upload this photo." };
  }

  const existingCount = await prisma.businessListingPhoto.count({ where: { businessListingId: listingId } });
  const photo = await prisma.businessListingPhoto.create({
    data: {
      businessListingId: listingId,
      storageKey: upload.storageKey,
      caption: caption || null,
      sortOrder: existingCount,
      isCover: existingCount === 0,
      uploadedByUserId: access.userId,
      is360: is360 ?? false,
    },
  });

  revalidatePath(`/dashboard/business-growth/${listingId}`);
  if (listing.status === "PUBLISHED") revalidatePath(`/listings/${listing.slug}`);
  return { ok: true, data: { id: photo.id } };
}

export async function removeListingPhotoAction(listingId: string, photoId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const photo = await prisma.businessListingPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.businessListingId !== listingId) return { ok: false, error: "Photo not found." };

  await prisma.businessListingPhoto.delete({ where: { id: photoId } });
  await removeListingPhoto(photo.storageKey).catch(() => {});

  revalidatePath(`/dashboard/business-growth/${listingId}`);
  if (listing.status === "PUBLISHED") revalidatePath(`/listings/${listing.slug}`);
  return { ok: true };
}

export async function reorderListingPhotos(listingId: string, orderedPhotoIds: string[]): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  await prisma.$transaction(
    orderedPhotoIds.map((photoId, index) =>
      prisma.businessListingPhoto.updateMany({ where: { id: photoId, businessListingId: listingId }, data: { sortOrder: index, isCover: index === 0 } }),
    ),
  );

  revalidatePath(`/dashboard/business-growth/${listingId}`);
  if (listing.status === "PUBLISHED") revalidatePath(`/listings/${listing.slug}`);
  return { ok: true };
}

export async function listOrgListings(): Promise<ActionResult<Awaited<ReturnType<typeof prisma.businessListing.findMany>>>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listings = await prisma.businessListing.findMany({ where: { organizationId: access.organizationId }, orderBy: { createdAt: "desc" } });
  return { ok: true, data: listings };
}
