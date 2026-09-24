"use server";

import { prisma } from "@/lib/prisma";

/** Real impression/click counters on a purchased ad placement — best-effort, mirrors recordListingView's own non-blocking contract (src/app/listings/[slug]/_lib/public-actions.ts). Never blocks rendering the banner if it fails. */
export async function recordAdImpression(placementId: string): Promise<void> {
  await prisma.listingAdPlacement.update({ where: { id: placementId }, data: { impressions: { increment: 1 } } }).catch((error) => {
    console.error("[listings/ad-actions] recordAdImpression failed:", error);
  });
}

export async function recordAdClick(placementId: string): Promise<void> {
  await prisma.listingAdPlacement.update({ where: { id: placementId }, data: { clicks: { increment: 1 } } }).catch((error) => {
    console.error("[listings/ad-actions] recordAdClick failed:", error);
  });
}
