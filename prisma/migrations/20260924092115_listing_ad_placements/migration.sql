-- CreateEnum
CREATE TYPE "ListingAdPlacementType" AS ENUM ('SEARCH_RESULTS_BANNER', 'LISTING_PAGE_BANNER');

-- AlterEnum
ALTER TYPE "GrowthTokenAction" ADD VALUE 'AD_PLACEMENT_PURCHASE';

-- CreateTable
CREATE TABLE "ListingAdPlacement" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "placement" "ListingAdPlacementType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingAdPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingAdPlacement_placement_startsAt_endsAt_idx" ON "ListingAdPlacement"("placement", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ListingAdPlacement_businessListingId_idx" ON "ListingAdPlacement"("businessListingId");

-- AddForeignKey
ALTER TABLE "ListingAdPlacement" ADD CONSTRAINT "ListingAdPlacement_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
