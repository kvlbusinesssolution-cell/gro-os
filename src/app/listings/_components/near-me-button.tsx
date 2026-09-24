"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

interface NearMeButtonProps {
  q: string;
  category: string;
  city: string;
  openNow: boolean;
  active: boolean;
}

/**
 * Browser Geolocation -> re-navigates /listings with lat/lng appended, so
 * the server component can sort by real distance. Takes the current filter
 * values as props (not useSearchParams()) so this component never needs a
 * Suspense boundary of its own.
 */
export function NearMeButton({ q, category, city, openNow, active }: NearMeButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Location isn't available in this browser.");
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (category) params.set("category", category);
        if (city) params.set("city", city);
        if (openNow) params.set("openNow", "1");
        params.set("lat", String(position.coords.latitude));
        params.set("lng", String(position.coords.longitude));
        setPending(false);
        router.push(`/listings?${params.toString()}`);
      },
      () => {
        setPending(false);
        toast.error("Couldn't get your location — check browser permissions.");
      },
    );
  }

  return (
    <Button type="button" variant={active ? "default" : "outline"} size="sm" disabled={pending} onClick={useMyLocation} className="gap-1.5">
      <LocateFixed className="size-3.5" />
      {pending ? "Locating…" : active ? "Sorted by distance" : "Near me"}
    </Button>
  );
}
