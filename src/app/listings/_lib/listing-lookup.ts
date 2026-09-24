import { prisma } from "@/lib/prisma";

/**
 * Public, unauthenticated listing lookup — no session/auth check by design,
 * same pattern as getSignatureByToken (src/app/dashboard/proposal/_lib/
 * signature-actions.ts). Unlike that token-based lookup, a listing's slug
 * is meant to be discoverable/indexed, not a secret — so the real access
 * control here is the `status: "PUBLISHED"` filter: a DRAFT/UNPUBLISHED/
 * SUSPENDED listing returns null (the page 404s) even if its slug leaks.
 */
export async function getPublishedListingBySlug(slug: string) {
  const listing = await prisma.businessListing.findUnique({
    where: { slug },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      reviews: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" } },
      deals: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" } },
      catalogItems: { where: { status: "PUBLISHED" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!listing || listing.status !== "PUBLISHED") return null;
  return listing;
}
