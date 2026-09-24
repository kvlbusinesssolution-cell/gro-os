import type { Metadata } from "next";
import Link from "next/link";

import { NavbarWithSession as Navbar } from "@/components/sections/navbar-with-session";
import { Footer } from "@/components/sections/footer";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { isOpenNow } from "@/lib/listings/hours";
import { haversineDistanceKm } from "@/lib/listings/geo";
import { ListingCard, type ListingCardData } from "./_components/listing-card";
import { ListingFilters } from "./_components/listing-filters";
import { GetQuotesForm } from "./_components/get-quotes-form";
import { AdBanner } from "./_components/ad-banner";
import { selectActiveAdPlacement } from "@/lib/listings/ad-rotation";

// Real crawler/scraper traffic hits a directory homepage hard — same ISR
// rationale as /listings/[slug], just a shorter window since this page's
// content (which listings are published) changes more often than one
// listing's own details.
export const revalidate = 300;

const PAGE_SIZE = 12;
const OPEN_NOW_SCAN_LIMIT = 300; // enough to cover this directory's current real scale without needing a raw-SQL JSON predicate

export const metadata: Metadata = {
  title: "Business Directory — find local businesses",
  description: "Search and browse published local business listings by category, city, and rating.",
  alternates: { canonical: "/listings" },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ListingsDirectoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();
  const category = first(sp.category).trim();
  const city = first(sp.city).trim();
  const openNowOnly = first(sp.openNow) === "1";
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const userLat = Number(first(sp.lat));
  const userLng = Number(first(sp.lng));
  const nearMe = Number.isFinite(userLat) && Number.isFinite(userLng) && first(sp.lat) !== "" && first(sp.lng) !== "";

  const conditions: Record<string, unknown>[] = [{ status: "PUBLISHED" }];
  if (city) conditions.push({ city });
  if (category) conditions.push({ OR: [{ category }, { categories: { has: category } }] });
  if (q) {
    conditions.push({
      OR: [
        { businessName: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const where = { AND: conditions };

  const cardSelect = {
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
    latitude: true,
    longitude: true,
    photos: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { id: true } },
  } as const;

  const orderBy = [{ isFeatured: "desc" as const }, { averageRating: "desc" as const }];

  let listings: ListingCardData[];
  let totalCount: number;

  if (nearMe) {
    // Same over-fetch-then-sort-in-process shape as the openNow branch below
    // — no PostGIS/geo-index in this stack, and at this directory's current
    // scale a real distance sort over a scan window is correct and simple.
    const candidates = await prisma.businessListing.findMany({
      where: { AND: [...conditions, { latitude: { not: null } }, { longitude: { not: null } }] },
      take: OPEN_NOW_SCAN_LIMIT,
      select: cardSelect,
    });
    const withDistance = candidates
      .filter((l) => (openNowOnly ? isOpenNow(l.openingHours) : true))
      .map((l) => ({ ...l, distanceKm: haversineDistanceKm(userLat, userLng, l.latitude!, l.longitude!) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    totalCount = withDistance.length;
    listings = withDistance.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else if (openNowOnly) {
    // No DB predicate for "open now" over a JSON column — over-fetch a real
    // scan window and filter/paginate in process. Correct and simple at this
    // directory's current scale; a raw-SQL JSON predicate is real added
    // complexity, deliberately not built until traffic justifies it.
    const candidates = await prisma.businessListing.findMany({ where, orderBy, take: OPEN_NOW_SCAN_LIMIT, select: cardSelect });
    const open = candidates.filter((l) => isOpenNow(l.openingHours));
    totalCount = open.length;
    listings = open.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    [listings, totalCount] = await Promise.all([
      prisma.businessListing.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: cardSelect }),
      prisma.businessListing.count({ where }),
    ]);
  }

  const [categoryRows, cityRows] = await Promise.all([
    prisma.businessListing.groupBy({ by: ["category"], where: { status: "PUBLISHED" } }),
    prisma.businessListing.groupBy({ by: ["city"], where: { status: "PUBLISHED" } }),
  ]);
  const categories = categoryRows.map((r) => r.category).sort();
  const cities = cityRows.map((r) => r.city).sort();

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  function pageHref(target: number): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (city) params.set("city", city);
    if (openNowOnly) params.set("openNow", "1");
    if (nearMe) {
      params.set("lat", String(userLat));
      params.set("lng", String(userLng));
    }
    params.set("page", String(target));
    return `/listings?${params.toString()}`;
  }

  const searchAd = await selectActiveAdPlacement("SEARCH_RESULTS_BANNER");

  return (
    <div className="theme-luxury">
      <Navbar />
      <main className="pt-16 sm:pt-24">
        <Container className="flex flex-col gap-8 py-12">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Business Directory</h1>
            <p className="text-muted-foreground">Find and contact local businesses by category and city.</p>
          </div>

          <ListingFilters q={q} category={category} city={city} openNow={openNowOnly} nearMe={nearMe} categories={categories} cities={cities} />

          {categories.length > 0 && cities.length > 0 && <GetQuotesForm categories={categories} cities={cities} />}

          {searchAd && <AdBanner ad={searchAd} />}

          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No businesses match these filters yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <ListingCard key={listing.slug} listing={listing} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>
                  Previous
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
                <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages}>
                  Next
                </Link>
              </Button>
            </div>
          )}
        </Container>
      </main>
      <Footer />
    </div>
  );
}
