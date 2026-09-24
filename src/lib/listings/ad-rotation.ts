import { prisma } from "@/lib/prisma";
import type { ListingAdPlacementType } from "@/generated/prisma/client";

export interface AdCandidate {
  id: string;
  impressions: number;
}

/**
 * Weighted-random pick among concurrently ACTIVE ad placements, favoring
 * whichever candidate(s) have fewer impressions so far — so paying
 * advertisers get a genuinely even rotation over time rather than whichever
 * placement happens to be first in a list. Returns null for an empty list
 * (never fabricates a winner when nothing real is available to show).
 */
export function pickAdCandidate<T extends AdCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const maxImpressions = Math.max(...candidates.map((c) => c.impressions));
  // Inverse weight (+1 so even the most-shown candidate keeps a real,
  // non-zero chance — never permanently locked out).
  const weights = candidates.map((c) => maxImpressions - c.impressions + 1);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export interface SelectedAdPlacement {
  placementId: string;
  businessListingId: string;
  businessName: string;
  slug: string;
  category: string;
  city: string;
  averageRating: number;
  reviewCount: number;
}

/** Real DB-backed selection for a given slot — only ever considers a placement whose window genuinely covers `now` AND whose listing is still PUBLISHED (a listing unpublished/suspended after buying an ad slot must never keep advertising). */
export async function selectActiveAdPlacement(placement: ListingAdPlacementType): Promise<SelectedAdPlacement | null> {
  const now = new Date();
  const candidates = await prisma.listingAdPlacement.findMany({
    where: { placement, startsAt: { lte: now }, endsAt: { gte: now }, businessListing: { status: "PUBLISHED" } },
    select: {
      id: true,
      businessListingId: true,
      impressions: true,
      businessListing: { select: { businessName: true, slug: true, category: true, city: true, averageRating: true, reviewCount: true } },
    },
  });

  const picked = pickAdCandidate(candidates.map((c) => ({ id: c.id, impressions: c.impressions })));
  if (!picked) return null;

  const full = candidates.find((c) => c.id === picked.id)!;
  return {
    placementId: full.id,
    businessListingId: full.businessListingId,
    businessName: full.businessListing.businessName,
    slug: full.businessListing.slug,
    category: full.businessListing.category,
    city: full.businessListing.city,
    averageRating: full.businessListing.averageRating,
    reviewCount: full.businessListing.reviewCount,
  };
}
