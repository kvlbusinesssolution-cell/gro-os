import { getSiteUrl } from "@/lib/site-config";

export interface FaqEntry {
  question: string;
  answer: string;
}

/** Generic FAQPage JSON-LD builder — real content only, sourced from wherever the actual FAQ list lives (see faq.tsx). */
export function buildFaqPageJsonLd(faqs: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export interface LocalBusinessJsonLdInput {
  slug: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  priceRange: string | null;
  averageRating: number;
  reviewCount: number;
  /** Absolute photo URLs (src/app/api/listings/photos/[id]/route.ts), already resolved by the caller. */
  photoUrls: string[];
}

/**
 * Real local-SEO structured data for a published Business Listing — this is
 * the actual, honest mechanism behind "help a client's business be found",
 * in contrast to a "#1 ranking" claim no software can make. Only emits
 * `aggregateRating` when reviewCount > 0 — Google's structured-data
 * guidelines explicitly disallow a fabricated/empty rating.
 */
export function buildLocalBusinessJsonLd(listing: LocalBusinessJsonLdInput) {
  const url = `${getSiteUrl()}/listings/${listing.slug}`;

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: listing.businessName,
    url,
    ...(listing.description ? { description: listing.description } : {}),
    ...(listing.phone ? { telephone: listing.phone } : {}),
    ...(listing.website ? { sameAs: listing.website } : {}),
    ...(listing.priceRange ? { priceRange: listing.priceRange } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: [listing.addressLine1, listing.addressLine2].filter(Boolean).join(", "),
      addressLocality: listing.city,
      ...(listing.state ? { addressRegion: listing.state } : {}),
      ...(listing.postalCode ? { postalCode: listing.postalCode } : {}),
      addressCountry: listing.country,
    },
    ...(listing.latitude !== null && listing.longitude !== null
      ? { geo: { "@type": "GeoCoordinates", latitude: listing.latitude, longitude: listing.longitude } }
      : {}),
    ...(listing.photoUrls.length > 0 ? { image: listing.photoUrls } : {}),
    ...(listing.reviewCount > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: listing.averageRating, reviewCount: listing.reviewCount } }
      : {}),
  };
}
