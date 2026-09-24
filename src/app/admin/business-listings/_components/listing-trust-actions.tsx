"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setListingVerified, suspendListing } from "../actions";

export function ListingTrustActions({ listingId, isVerified, status }: { listingId: string; isVerified: boolean; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggleVerified() {
    startTransition(async () => {
      const result = await setListingVerified(listingId, !isVerified);
      if (!result.ok) {
        toast.error(result.error ?? "Could not update this listing.");
        return;
      }
      router.refresh();
    });
  }

  function suspend() {
    if (!confirm("Suspend this listing? It will be removed from public view immediately.")) return;
    startTransition(async () => {
      const result = await suspendListing(listingId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not suspend this listing.");
        return;
      }
      toast.success("Listing suspended.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={isVerified ? "outline" : "default"} size="sm" disabled={pending} onClick={toggleVerified}>
        {isVerified ? "Remove verification" : "Verify"}
      </Button>
      {status !== "SUSPENDED" && (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={suspend} className="text-destructive">
          Suspend
        </Button>
      )}
    </div>
  );
}
