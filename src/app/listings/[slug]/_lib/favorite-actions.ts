"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface ActionResult {
  ok: boolean;
  error?: string;
  favorited?: boolean;
}

/** Any signed-in user can favorite a listing — deliberately no membership/org requirement, unlike every other action in this feature, since a consumer bookmarking a business is not a business-owner action. */
export async function toggleFavorite(listingId: string, slug: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Sign in to save businesses to your favorites." };

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId }, select: { status: true } });
  if (!listing || listing.status !== "PUBLISHED") return { ok: false, error: "Listing not found." };

  const existing = await prisma.businessListingFavorite.findUnique({ where: { userId_businessListingId: { userId, businessListingId: listingId } } });
  if (existing) {
    await prisma.businessListingFavorite.delete({ where: { id: existing.id } });
    revalidatePath(`/listings/${slug}`);
    revalidatePath("/listings/favorites");
    return { ok: true, favorited: false };
  }

  await prisma.businessListingFavorite.create({ data: { userId, businessListingId: listingId } });
  revalidatePath(`/listings/${slug}`);
  revalidatePath("/listings/favorites");
  return { ok: true, favorited: true };
}
