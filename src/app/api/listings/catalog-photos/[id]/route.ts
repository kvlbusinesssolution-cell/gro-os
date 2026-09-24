import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readListingPhoto, LISTING_PHOTO_CONTENT_TYPE_BY_EXTENSION } from "@/lib/listings/photos";

/**
 * Public catalog-item-photo download — same "parent listing's status is the
 * real authorization check" pattern as src/app/api/listings/photos/[id]/
 * route.ts, just resolved through BusinessListingCatalogItem instead of
 * BusinessListingPhoto. A DRAFT/UNPUBLISHED/SUSPENDED listing, or a
 * DRAFT/ARCHIVED catalog item, 404s even if the id leaks.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const item = await prisma.businessListingCatalogItem.findUnique({
    where: { id },
    include: { businessListing: { select: { status: true } } },
  });
  if (!item || !item.photoStorageKey || item.status !== "PUBLISHED" || item.businessListing.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = item.photoStorageKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType = LISTING_PHOTO_CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";

  try {
    const buffer = await readListingPhoto(item.photoStorageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    console.error("[api/listings/catalog-photos] failed to read file:", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
