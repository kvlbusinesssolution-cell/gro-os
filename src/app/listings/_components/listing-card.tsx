import Link from "next/link";
import { Star, MapPin, BadgeCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isOpenNow } from "@/lib/listings/hours";

export interface ListingCardData {
  slug: string;
  businessName: string;
  tagline: string | null;
  category: string;
  city: string;
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
  isFeatured: boolean;
  featuredUntil: Date | null;
  openingHours: unknown;
  photos: { id: string }[];
}

export function ListingCard({ listing }: { listing: ListingCardData }) {
  const featured = listing.isFeatured && (!listing.featuredUntil || listing.featuredUntil > new Date());
  const openNow = isOpenNow(listing.openingHours);
  const coverPhoto = listing.photos[0];

  return (
    <Link
      href={`/listings/${listing.slug}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/30",
        featured && "border-amber-400/60 bg-amber-400/5",
      )}
    >
      {coverPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from a local, non-domain-configured API route
        <img src={`/api/listings/photos/${coverPhoto.id}`} alt={listing.businessName} className="aspect-video w-full rounded-lg object-cover" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">No photo</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {featured && (
          <Badge variant="outline" className="gap-1 border-amber-400/60 text-amber-600 dark:text-amber-400">
            <Sparkles className="size-3" /> Featured
          </Badge>
        )}
        {listing.isVerified && (
          <Badge variant="outline" className="gap-1 border-emerald-400/60 text-emerald-600 dark:text-emerald-400">
            <BadgeCheck className="size-3" /> Verified
          </Badge>
        )}
        <Badge variant="outline">{listing.category}</Badge>
        <span className={cn("text-xs font-medium", openNow ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {openNow ? "Open now" : "Closed"}
        </span>
      </div>

      <h3 className="font-semibold text-foreground">{listing.businessName}</h3>
      {listing.tagline && <p className="line-clamp-1 text-sm text-muted-foreground">{listing.tagline}</p>}

      <div className="mt-auto flex items-center justify-between text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <MapPin className="size-3.5" /> {listing.city}
        </span>
        {listing.reviewCount > 0 && (
          <span className="flex items-center gap-1">
            <Star className="size-3.5 fill-amber-400 text-amber-400" /> {listing.averageRating.toFixed(1)} ({listing.reviewCount})
          </span>
        )}
      </div>
    </Link>
  );
}
