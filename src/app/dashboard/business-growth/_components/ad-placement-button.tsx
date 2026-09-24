"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { purchaseAdPlacement } from "../_lib/ad-placement-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";
import type { ListingAdPlacementType } from "@/generated/prisma/client";

const LABEL: Record<ListingAdPlacementType, string> = {
  SEARCH_RESULTS_BANNER: "Search Results Banner",
  LISTING_PAGE_BANNER: "Other Listing Pages Banner",
};

export function AdPlacementButton({ listingId, placement }: { listingId: string; placement: ListingAdPlacementType }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function purchase() {
    startTransition(async () => {
      const result = await purchaseAdPlacement(listingId, placement);
      if (!result.ok) {
        toast.error(result.error ?? "Could not buy this ad placement.");
        return;
      }
      toast.success(`${LABEL[placement]} placement active for 7 days.`);
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={purchase}>
      {pending ? "Buying…" : `Buy ${LABEL[placement]} (7 days, ${GROWTH_TOKEN_COST.AD_PLACEMENT_PURCHASE} tokens)`}
    </Button>
  );
}
