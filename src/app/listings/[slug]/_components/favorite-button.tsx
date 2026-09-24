"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { toggleFavorite } from "../_lib/favorite-actions";

export function FavoriteButton({ listingId, slug, initialFavorited }: { listingId: string; slug: string; initialFavorited: boolean }) {
  const [pending, startTransition] = useTransition();
  const [favorited, setFavorited] = useState(initialFavorited);

  function toggle() {
    startTransition(async () => {
      const result = await toggleFavorite(listingId, slug);
      if (!result.ok) {
        toast.error(result.error ?? "Could not update favorites.");
        return;
      }
      setFavorited(result.favorited ?? false);
    });
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={toggle} className="gap-1.5">
      <Heart className={cn("size-4", favorited && "fill-rose-500 text-rose-500")} />
      {favorited ? "Saved" : "Save"}
    </Button>
  );
}
