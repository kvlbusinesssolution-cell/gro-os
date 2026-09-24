"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { saveCatalogItemPhoto, removeCatalogItemPhoto } from "@/lib/listings/photos";
import { businessCatalogItemInputSchema, type BusinessCatalogItemInput } from "@/lib/validations/listings";
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
  if (!EDITOR_ROLES.has(membership.role)) return { ok: false, error: "Only an Owner, Admin, Manager, or Marketing member can manage the catalog." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedListing(organizationId: string, listingId: string) {
  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== organizationId) return null;
  return listing;
}

async function resolveOwnedCatalogItem(organizationId: string, catalogItemId: string) {
  const item = await prisma.businessListingCatalogItem.findUnique({ where: { id: catalogItemId }, include: { businessListing: true } });
  if (!item || item.businessListing.organizationId !== organizationId) return null;
  return item;
}

export async function createCatalogItem(listingId: string, input: BusinessCatalogItemInput): Promise<ActionResult<{ id: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const parsed = businessCatalogItemInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the item details." };
  const data = parsed.data;

  const existingCount = await prisma.businessListingCatalogItem.count({ where: { businessListingId: listingId } });
  const item = await prisma.businessListingCatalogItem.create({
    data: {
      businessListingId: listingId,
      name: data.name,
      description: data.description || null,
      price: data.price ?? null,
      priceUnit: data.priceUnit || null,
      sortOrder: existingCount,
    },
  });

  revalidatePath(`/dashboard/business-growth/${listingId}/catalog`);
  return { ok: true, data: { id: item.id } };
}

/** Editing a DRAFT or a live item is free — only publishCatalogItem spends Growth Tokens. */
export async function updateCatalogItem(catalogItemId: string, input: BusinessCatalogItemInput): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const item = await resolveOwnedCatalogItem(access.organizationId, catalogItemId);
  if (!item) return { ok: false, error: "Catalog item not found." };

  const parsed = businessCatalogItemInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the item details." };
  const data = parsed.data;

  await prisma.businessListingCatalogItem.update({
    where: { id: catalogItemId },
    data: { name: data.name, description: data.description || null, price: data.price ?? null, priceUnit: data.priceUnit || null },
  });

  revalidatePath(`/dashboard/business-growth/${item.businessListingId}/catalog`);
  if (item.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${item.businessListing.slug}`);
  return { ok: true };
}

/** The ONLY place a catalog item's Growth Token cost is charged — same transaction-composed pattern as publishListing/publishDeal. */
export async function publishCatalogItem(catalogItemId: string): Promise<ActionResult<{ remainingTokens?: number }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const item = await resolveOwnedCatalogItem(access.organizationId, catalogItemId);
  if (!item) return { ok: false, error: "Catalog item not found." };
  if (item.status === "PUBLISHED") return { ok: true, data: {} };

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "CATALOG_ITEM_PUBLISH", {
        referenceType: "BusinessListingCatalogItem",
        referenceId: catalogItemId,
        context: "business-growth:publish-catalog-item",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to publish this item.");

      await tx.businessListingCatalogItem.update({ where: { id: catalogItemId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_catalog_item.published",
      metadata: { catalogItemId, tokensCost: GROWTH_TOKEN_COST.CATALOG_ITEM_PUBLISH },
    });

    revalidatePath(`/dashboard/business-growth/${item.businessListingId}/catalog`);
    revalidatePath(`/listings/${item.businessListing.slug}`);
    return { ok: true, data: { remainingTokens } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not publish this item." };
  }
}

export async function archiveCatalogItem(catalogItemId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const item = await resolveOwnedCatalogItem(access.organizationId, catalogItemId);
  if (!item) return { ok: false, error: "Catalog item not found." };

  await prisma.businessListingCatalogItem.update({ where: { id: catalogItemId }, data: { status: "ARCHIVED" } });

  revalidatePath(`/dashboard/business-growth/${item.businessListingId}/catalog`);
  if (item.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${item.businessListing.slug}`);
  return { ok: true };
}

export async function deleteCatalogItem(catalogItemId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const item = await resolveOwnedCatalogItem(access.organizationId, catalogItemId);
  if (!item) return { ok: false, error: "Catalog item not found." };

  await prisma.businessListingCatalogItem.delete({ where: { id: catalogItemId } });
  if (item.photoStorageKey) await removeCatalogItemPhoto(item.photoStorageKey).catch(() => {});

  revalidatePath(`/dashboard/business-growth/${item.businessListingId}/catalog`);
  if (item.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${item.businessListing.slug}`);
  return { ok: true };
}

export async function setCatalogItemPhoto(catalogItemId: string, file: File): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const item = await resolveOwnedCatalogItem(access.organizationId, catalogItemId);
  if (!item) return { ok: false, error: "Catalog item not found." };

  let upload;
  try {
    upload = await saveCatalogItemPhoto(catalogItemId, file);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not upload this photo." };
  }

  const previousKey = item.photoStorageKey;
  await prisma.businessListingCatalogItem.update({ where: { id: catalogItemId }, data: { photoStorageKey: upload.storageKey } });
  if (previousKey && previousKey !== upload.storageKey) await removeCatalogItemPhoto(previousKey).catch(() => {});

  revalidatePath(`/dashboard/business-growth/${item.businessListingId}/catalog`);
  if (item.businessListing.status === "PUBLISHED") revalidatePath(`/listings/${item.businessListing.slug}`);
  return { ok: true };
}
