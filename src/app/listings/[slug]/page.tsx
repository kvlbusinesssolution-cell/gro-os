import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Star, MapPin, BadgeCheck } from "lucide-react";

import { NavbarWithSession as Navbar } from "@/components/sections/navbar-with-session";
import { Footer } from "@/components/sections/footer";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getSiteUrl } from "@/lib/site-config";
import { buildLocalBusinessJsonLd } from "@/lib/seo/json-ld";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isListingFavorited } from "@/lib/listings/favorites";
import { toEmbedUrl } from "@/lib/listings/video-embed";
import { getPublishedListingBySlug } from "../_lib/listing-lookup";
import { ListingCard } from "../_components/listing-card";
import { CallButton, WhatsAppButton } from "./_components/lead-buttons";
import { EnquiryForm } from "./_components/enquiry-form";
import { ReviewForm } from "./_components/review-form";
import { DealCard } from "./_components/deal-card";
import { ViewTracker } from "./_components/view-tracker";
import { FavoriteButton } from "./_components/favorite-button";
import { ShareButton } from "./_components/share-button";
import { ReportListingButton } from "./_components/report-listing-button";
import { MapEmbed } from "./_components/map-embed";
import { TrustScoreBadge } from "./_components/trust-score-badge";
import { PhotoSphereViewer } from "./_components/photo-sphere-viewer";
import { AdBanner } from "../_components/ad-banner";
import { selectActiveAdPlacement } from "@/lib/listings/ad-rotation";

// ISR — real local-SEO pages get real crawler traffic; this keeps TTFB fast
// and blunts DB load from bursty crawler/scraper requests, rather than
// re-rendering fully on every request. See src/app/listings/[slug]/_lib/
// public-actions.ts's recordListingView for why view counting instead
// happens client-side rather than in this render function.
export const revalidate = 3600;

function photoUrl(photoId: string): string {
  return `${getSiteUrl()}/api/listings/photos/${photoId}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getPublishedListingBySlug(slug);
  if (!listing) return { title: "Listing not found" };

  const title = listing.metaTitle || `${listing.businessName} — ${listing.city}`;
  const description = listing.metaDescription || listing.description || `${listing.businessName}, ${listing.category} in ${listing.city}.`;
  const images = listing.photos.slice(0, 1).map((p) => photoUrl(p.id));

  return {
    title,
    description,
    alternates: { canonical: `/listings/${listing.slug}` },
    openGraph: { title, description, images },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getPublishedListingBySlug(slug);
  if (!listing) notFound();

  const session = await auth();
  const favorited = session?.user?.id ? await isListingFavorited(session.user.id, listing.id) : false;
  const pageAd = await selectActiveAdPlacement("LISTING_PAGE_BANNER");

  const similarListings = await prisma.businessListing.findMany({
    where: {
      status: "PUBLISHED",
      id: { not: listing.id },
      OR: [{ category: listing.category }, { city: listing.city }],
    },
    orderBy: [{ isFeatured: "desc" }, { averageRating: "desc" }],
    take: 4,
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
      photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
    },
  });

  const videoEmbedUrl = listing.videoUrl ? toEmbedUrl(listing.videoUrl) : null;

  const jsonLd = buildLocalBusinessJsonLd({
    slug: listing.slug,
    businessName: listing.businessName,
    description: listing.description,
    phone: listing.phone,
    website: listing.website,
    addressLine1: listing.addressLine1,
    addressLine2: listing.addressLine2,
    city: listing.city,
    state: listing.state,
    postalCode: listing.postalCode,
    country: listing.country,
    latitude: listing.latitude,
    longitude: listing.longitude,
    priceRange: listing.priceRange,
    averageRating: listing.averageRating,
    reviewCount: listing.reviewCount,
    photoUrls: listing.photos.map((p) => photoUrl(p.id)),
  });

  return (
    <div className="theme-luxury">
      <ViewTracker listingId={listing.id} />
      {/* real schema.org LocalBusiness structured data, not user-controlled HTML */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Navbar />
      <main className="pt-16 sm:pt-24">
        <Container className="flex flex-col gap-8 py-12">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{listing.businessName}</h1>
              {listing.isVerified && (
                <Badge variant="outline" className="gap-1 border-emerald-400/60 text-emerald-600 dark:text-emerald-400">
                  <BadgeCheck className="size-3" /> Verified
                </Badge>
              )}
              <Badge variant="outline">{listing.category}</Badge>
              <TrustScoreBadge
                listing={{
                  isVerified: listing.isVerified,
                  averageRating: listing.averageRating,
                  reviewCount: listing.reviewCount,
                  description: listing.description,
                  photoCount: listing.photos.length,
                  phone: listing.phone,
                  whatsappNumber: listing.whatsappNumber,
                  website: listing.website,
                  openingHours: listing.openingHours,
                }}
              />
            </div>
            {listing.tagline && <p className="text-lg text-muted-foreground">{listing.tagline}</p>}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="size-4" /> {listing.addressLine1}, {listing.city}
                {listing.state ? `, ${listing.state}` : ""}
              </span>
              {listing.reviewCount > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="size-4 fill-amber-400 text-amber-400" /> {listing.averageRating.toFixed(1)} ({listing.reviewCount} reviews)
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {listing.phone && <CallButton listingId={listing.id} phone={listing.phone} />}
              {listing.whatsappNumber && <WhatsAppButton listingId={listing.id} whatsappNumber={listing.whatsappNumber} />}
              <FavoriteButton listingId={listing.id} slug={listing.slug} initialFavorited={favorited} />
              <ShareButton title={listing.businessName} url={`${getSiteUrl()}/listings/${listing.slug}`} />
              <ReportListingButton listingId={listing.id} />
            </div>
          </div>

          {videoEmbedUrl && (
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-border">
              <iframe title={`${listing.businessName} video`} src={videoEmbedUrl} className="size-full" allowFullScreen loading="lazy" />
            </div>
          )}

          {listing.photos.some((p) => p.is360) && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">360° Tour</h2>
              {listing.photos
                .filter((p) => p.is360)
                .map((photo) => <PhotoSphereViewer key={photo.id} src={`/api/listings/photos/${photo.id}`} alt={photo.caption ?? listing.businessName} />)}
            </div>
          )}

          {listing.photos.some((p) => !p.is360) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {listing.photos
                .filter((p) => !p.is360)
                .map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element -- served from a local, non-domain-configured API route, not a next/image-eligible remote host
                  <img key={photo.id} src={`/api/listings/photos/${photo.id}`} alt={photo.caption ?? listing.businessName} className={cn("aspect-square w-full rounded-xl object-cover", photo.isCover && "sm:col-span-2 sm:row-span-2")} />
                ))}
            </div>
          )}

          {pageAd && pageAd.businessListingId !== listing.id && <AdBanner ad={pageAd} />}

          {listing.description && <p className="max-w-3xl text-foreground">{listing.description}</p>}

          {listing.catalogItems.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Products &amp; services</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {listing.catalogItems.map((item) => (
                  <div key={item.id} className="flex gap-3 rounded-xl border border-border p-4">
                    {item.photoStorageKey && (
                      // eslint-disable-next-line @next/next/no-img-element -- served from a local, non-domain-configured API route
                      <img src={`/api/listings/catalog-photos/${item.id}`} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                    )}
                    <div>
                      <p className="font-medium text-foreground">{item.name}</p>
                      {item.price != null && (
                        <p className="text-sm text-muted-foreground">
                          ₹{item.price}
                          {item.priceUnit ? ` ${item.priceUnit}` : ""}
                        </p>
                      )}
                      {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listing.latitude != null && listing.longitude != null && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Location</h2>
              <MapEmbed latitude={listing.latitude} longitude={listing.longitude} label={listing.businessName} />
            </div>
          )}

          {listing.deals.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Deals & offers</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {listing.deals.map((deal) => (
                  <DealCard key={deal.id} listingId={listing.id} deal={deal} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-8 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Reviews</h2>
              {listing.reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet — be the first.</p>}
              {listing.reviews.map((review) => (
                <div key={review.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={cn("size-3.5", n <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                    ))}
                    <span className="ml-2 text-sm font-medium text-foreground">{review.reviewerName}</span>
                  </div>
                  {review.title && <p className="text-sm font-medium text-foreground">{review.title}</p>}
                  {review.body && <p className="text-sm text-muted-foreground">{review.body}</p>}
                </div>
              ))}
              <ReviewForm listingId={listing.id} />
            </div>

            <div>
              <h2 className="mb-3 text-xl font-semibold text-foreground">Get in touch</h2>
              <EnquiryForm listingId={listing.id} />
            </div>
          </div>

          {similarListings.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Similar businesses</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {similarListings.map((similar) => (
                  <ListingCard key={similar.slug} listing={similar} />
                ))}
              </div>
            </div>
          )}
        </Container>
      </main>
      <Footer />
    </div>
  );
}
