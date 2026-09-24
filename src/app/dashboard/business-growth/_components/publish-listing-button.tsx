"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { publishListing, unpublishListing, deleteListing } from "../_lib/listing-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

export function PublishListingButton({ listingId, status }: { listingId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function publish() {
    startTransition(async () => {
      const result = await publishListing(listingId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not publish this listing.");
        return;
      }
      toast.success("Listing published.");
      router.refresh();
    });
  }

  function unpublish() {
    startTransition(async () => {
      const result = await unpublishListing(listingId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not unpublish this listing.");
        return;
      }
      toast.success("Listing unpublished.");
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this listing permanently? This can't be undone.")) return;
    startTransition(async () => {
      const result = await deleteListing(listingId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this listing.");
        return;
      }
      toast.success("Listing deleted.");
      router.push("/dashboard/business-growth");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PUBLISHED" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={unpublish}>
          {pending ? "Working…" : "Unpublish"}
        </Button>
      ) : (
        <Button type="button" disabled={pending} onClick={publish}>
          {pending ? "Publishing…" : `Publish (${GROWTH_TOKEN_COST.LISTING_PUBLISH} tokens)`}
        </Button>
      )}
      <Button type="button" variant="ghost" disabled={pending} onClick={remove} className="text-destructive">
        Delete
      </Button>
    </div>
  );
}
