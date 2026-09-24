import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { readListingPhoto, LISTING_PHOTO_CONTENT_TYPE_BY_EXTENSION } from "@/lib/listings/photos";

/**
 * Public, unauthenticated listing-photo download — deliberately different
 * from the avatar route it's modeled on (src/app/api/users/[id]/avatar/
 * route.ts, which requires ANY signed-in session): a listing photo is meant
 * to be publicly visible and indexed by Google Images. The real
 * authorization check here is the parent listing's status, not a session —
 * a photo belonging to a DRAFT/UNPUBLISHED/SUSPENDED listing 404s even if
 * its id/storage key leaks. Long public Cache-Control since these are
 * meant to be CDN/browser-cached at real scale, unlike the avatar route's
 * "private, max-age=300".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const photo = await prisma.businessListingPhoto.findUnique({
    where: { id },
    include: { businessListing: { select: { status: true } } },
  });
  if (!photo || photo.businessListing.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = photo.storageKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType = LISTING_PHOTO_CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";

  try {
    const buffer = await readListingPhoto(photo.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    console.error("[api/listings/photos] failed to read file:", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
