"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { publishCatalogItem, archiveCatalogItem, deleteCatalogItem, setCatalogItemPhoto } from "../_lib/catalog-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

export function CatalogRowActions({ itemId, status }: { itemId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function publish() {
    startTransition(async () => {
      const result = await publishCatalogItem(itemId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not publish this item.");
        return;
      }
      toast.success("Item published.");
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const result = await archiveCatalogItem(itemId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not archive this item.");
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this item permanently?")) return;
    startTransition(async () => {
      const result = await deleteCatalogItem(itemId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this item.");
        return;
      }
      router.refresh();
    });
  }

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    startTransition(async () => {
      const result = await setCatalogItemPhoto(itemId, file);
      if (!result.ok) {
        toast.error(result.error ?? "Could not upload this photo.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={handlePhoto} disabled={pending} className="hidden" />
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        Photo
      </Button>
      {status === "PUBLISHED" ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={archive}>
          Archive
        </Button>
      ) : status !== "ARCHIVED" ? (
        <Button type="button" size="sm" disabled={pending} onClick={publish}>
          {pending ? "Publishing…" : `Publish (${GROWTH_TOKEN_COST.CATALOG_ITEM_PUBLISH} tokens)`}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove} className="text-destructive">
        Delete
      </Button>
    </div>
  );
}
