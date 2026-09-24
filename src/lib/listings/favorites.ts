import { prisma } from "@/lib/prisma";

/** Read-only helpers for the Favorites feature — any signed-in user, no organization/membership required (a consumer browsing /listings may have no org at all). */

export async function isListingFavorited(userId: string, businessListingId: string): Promise<boolean> {
  const row = await prisma.businessListingFavorite.findUnique({ where: { userId_businessListingId: { userId, businessListingId } } });
  return row !== null;
}

export async function listFavoriteListings(userId: string) {
  const favorites = await prisma.businessListingFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      businessListing: {
        select: {
          slug: true,
          businessName: true,
          tagline: true,
          category: true,
          city: true,
          averageRating: true,
          reviewCount: true,
          isVerified: true,
          isFeatured: true,
          featuredUntil: true,
          openingHours: true,
          status: true,
          photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
        },
      },
    },
  });
  // A favorited listing can later be unpublished by its owner — filter those
  // out here rather than 404ing the whole page for one stale bookmark.
  return favorites.filter((f) => f.businessListing.status === "PUBLISHED").map((f) => f.businessListing);
}
