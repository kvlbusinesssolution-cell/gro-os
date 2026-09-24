-- AlterEnum
ALTER TYPE "GrowthTokenAction" ADD VALUE 'LISTING_FEATURE';

-- AlterTable
ALTER TABLE "BusinessListing" ADD COLUMN     "featuredUntil" TIMESTAMP(3),
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BusinessListingLead" ADD COLUMN     "quoteBatchId" TEXT;

-- AlterTable
ALTER TABLE "BusinessReview" ADD COLUMN     "ownerRepliedAt" TIMESTAMP(3),
ADD COLUMN     "ownerReplyBody" TEXT;

-- CreateIndex
CREATE INDEX "BusinessListingLead_quoteBatchId_idx" ON "BusinessListingLead"("quoteBatchId");
