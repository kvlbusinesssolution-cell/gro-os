import type { MetadataRoute } from "next";

import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/site-config";

const BASE_URL = getSiteUrl();

const PUBLIC_PAGES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/product", changeFrequency: "weekly", priority: 0.9 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
];

/** First DB-driven sitemap entries in this codebase — every real PUBLISHED Business Listing (src/app/listings/[slug]/page.tsx), the actual local-SEO surface this section exists to build. Only PUBLISHED, matching that page's own access check. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));

  const listings = await prisma.businessListing.findMany({
    where: { status: "PUBLISHED" },
    select: { slug: true, updatedAt: true },
  });
  const listingEntries: MetadataRoute.Sitemap = listings.map((listing) => ({
    url: `${BASE_URL}/listings/${listing.slug}`,
    lastModified: listing.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticEntries, ...listingEntries];
}
