import { createFileStore } from "@/lib/storage/file-store";
import { compressRasterImage, RASTER_EXTENSION_BY_TYPE, RASTER_CONTENT_TYPE_BY_EXTENSION } from "@/lib/storage/image-compression";

/**
 * Local-disk storage for Business Listing photo uploads — same convention
 * as src/lib/storage/avatars.ts. Files live under
 * <project root>/storage/listing-photos/, never under public/. Unlike
 * avatars (one per user, auth-gated read), listing photos are meant to be
 * PUBLICLY served (indexed by Google Images) once their parent listing is
 * PUBLISHED — see src/app/api/listings/photos/[id]/route.ts, which is the
 * one place that reads them back, and which itself re-checks the parent
 * listing's status before serving.
 */
const store = createFileStore("listing-photos");

// Listing photos are marketing shots, often higher-res than a profile
// avatar — same raster-only reasoning as avatars.ts, larger cap.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSION_BY_TYPE = RASTER_EXTENSION_BY_TYPE;
export const LISTING_PHOTO_CONTENT_TYPE_BY_EXTENSION = RASTER_CONTENT_TYPE_BY_EXTENSION;

export interface ListingPhotoUploadResult {
  storageKey: string;
}

export async function saveListingPhoto(businessListingId: string, file: File): Promise<ListingPhotoUploadResult> {
  if (file.size === 0) {
    throw new Error("Choose a photo to upload.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Photo must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.`);
  }

  const extension = ALLOWED_EXTENSION_BY_TYPE[file.type];
  if (!extension) {
    throw new Error(`Unsupported image type "${file.type || "unknown"}". Use PNG, JPEG, WebP, GIF, or AVIF.`);
  }

  const original = Buffer.from(await file.arrayBuffer());
  const output = await compressRasterImage(original, extension);

  // entityId is a fresh random id per photo (not the businessListingId
  // itself, unlike avatars.ts's single-photo-per-user "avatar" entityId) —
  // a listing has many photos, so each needs its own unique key within the
  // listing's scopeId folder.
  const entityId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const storageKey = await store.save(businessListingId, entityId, `photo.${extension}`, output);
  return { storageKey };
}

export async function readListingPhoto(storageKey: string): Promise<Buffer> {
  return store.read(storageKey);
}

export async function removeListingPhoto(storageKey: string): Promise<void> {
  return store.remove(storageKey);
}

/**
 * Same underlying store as saveListingPhoto — a catalog item's single photo
 * is just another file under the same "listing-photos" root, scoped by
 * catalogItemId instead of businessListingId. Served back by
 * src/app/api/listings/catalog-photos/[id]/route.ts.
 */
export async function saveCatalogItemPhoto(catalogItemId: string, file: File): Promise<ListingPhotoUploadResult> {
  if (file.size === 0) {
    throw new Error("Choose a photo to upload.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Photo must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.`);
  }

  const extension = ALLOWED_EXTENSION_BY_TYPE[file.type];
  if (!extension) {
    throw new Error(`Unsupported image type "${file.type || "unknown"}". Use PNG, JPEG, WebP, GIF, or AVIF.`);
  }

  const original = Buffer.from(await file.arrayBuffer());
  const output = await compressRasterImage(original, extension);
  const storageKey = await store.save(catalogItemId, "photo", `photo.${extension}`, output);
  return { storageKey };
}

export async function removeCatalogItemPhoto(storageKey: string): Promise<void> {
  return store.remove(storageKey);
}
