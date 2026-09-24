"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SelectedAdPlacement } from "@/lib/listings/ad-rotation";
import { recordAdImpression, recordAdClick } from "../_lib/ad-actions";

/** Real sponsored-ad slot — the business behind it actually paid Growth Tokens for this placement (see purchaseAdPlacement, business-growth/_lib/ad-placement-actions.ts). Always labeled "Sponsored," never blended in as an organic result. */
export function AdBanner({ ad }: { ad: SelectedAdPlacement }) {
  useEffect(() => {
    void recordAdImpression(ad.placementId);
    // Only record once per real render of this specific placement — never
    // re-fires on an unrelated re-render since `ad.placementId` only
    // changes when a genuinely different ad was selected.
  }, [ad.placementId]);

  return (
    <Link href={`/listings/${ad.slug}`} onClick={() => void recordAdClick(ad.placementId)}>
      <Card className="border-amber-400/50 bg-amber-50/40 transition-colors hover:border-amber-400 dark:bg-amber-950/10">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
                Sponsored
              </Badge>
              <span className="font-medium text-foreground">{ad.businessName}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {ad.category} · {ad.city}
            </p>
          </div>
          {ad.reviewCount > 0 && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Star className="size-4 fill-amber-400 text-amber-400" /> {ad.averageRating.toFixed(1)} ({ad.reviewCount})
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
