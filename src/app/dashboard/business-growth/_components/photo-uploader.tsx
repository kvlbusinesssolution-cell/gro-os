"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { addListingPhoto, removeListingPhotoAction } from "../_lib/listing-actions";

interface Photo {
  id: string;
  storageKey: string;
  isCover: boolean;
  is360?: boolean;
}

export function PhotoUploader({ listingId, photos }: { listingId: string; photos: Photo[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [is360, setIs360] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    startTransition(async () => {
      const result = await addListingPhoto(listingId, file, undefined, is360);
      if (!result.ok) {
        toast.error(result.error ?? "Could not upload this photo.");
        return;
      }
      toast.success(is360 ? "360° photo added." : "Photo added.");
      setIs360(false);
      router.refresh();
    });
  }

  function handleRemove(photoId: string) {
    startTransition(async () => {
      const result = await removeListingPhotoAction(listingId, photoId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not remove this photo.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {photos.map((photo) => (
          <div key={photo.id} className="group relative size-24 overflow-hidden rounded-lg border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from a local, non-domain-configured API route, not a next/image-eligible remote host */}
            <img src={`/api/listings/photos/${photo.id}`} alt="" className="size-full object-cover" />
            {photo.isCover && <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px] font-medium">Cover</span>}
            {photo.is360 && <span className="absolute left-1 bottom-1 rounded bg-background/80 px-1 text-[10px] font-medium">360°</span>}
            <button
              type="button"
              onClick={() => handleRemove(photo.id)}
              disabled={pending}
              className="absolute right-1 top-1 hidden rounded bg-background/80 p-1 group-hover:block"
            >
              <Trash2 className="size-3.5 text-destructive" />
            </button>
          </div>
        ))}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={handleUpload} disabled={pending} className="hidden" />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()} className="w-fit">
          {pending ? "Uploading…" : "Add photo"}
        </Button>
        <label htmlFor="photo-is-360" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox id="photo-is-360" checked={is360} onChange={(e) => setIs360(e.target.checked)} /> This is a 360° panorama photo
        </label>
      </div>
    </div>
  );
}
