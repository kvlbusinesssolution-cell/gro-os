-- CreateEnum
CREATE TYPE "BusinessCatalogItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessListingReportReason" AS ENUM ('INCORRECT_INFO', 'PERMANENTLY_CLOSED', 'SPAM_OR_SCAM', 'INAPPROPRIATE_CONTENT', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessListingReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "GrowthTokenAction" ADD VALUE 'CATALOG_ITEM_PUBLISH';

-- AlterTable
ALTER TABLE "BusinessListing" ADD COLUMN     "videoUrl" TEXT;

-- CreateTable
CREATE TABLE "BusinessListingCatalogItem" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "priceUnit" TEXT,
    "photoStorageKey" TEXT,
    "status" "BusinessCatalogItemStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessListingCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListingDailyStat" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "leadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BusinessListingDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListingFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessListingFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListingReport" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "reason" "BusinessListingReportReason" NOT NULL,
    "details" TEXT,
    "reporterEmail" TEXT,
    "ipAddress" TEXT,
    "status" "BusinessListingReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessListingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessListingCatalogItem_businessListingId_status_sortOrd_idx" ON "BusinessListingCatalogItem"("businessListingId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "BusinessListingDailyStat_businessListingId_date_idx" ON "BusinessListingDailyStat"("businessListingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessListingDailyStat_businessListingId_date_key" ON "BusinessListingDailyStat"("businessListingId", "date");

-- CreateIndex
CREATE INDEX "BusinessListingFavorite_userId_idx" ON "BusinessListingFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessListingFavorite_userId_businessListingId_key" ON "BusinessListingFavorite"("userId", "businessListingId");

-- CreateIndex
CREATE INDEX "BusinessListingReport_businessListingId_status_idx" ON "BusinessListingReport"("businessListingId", "status");

-- CreateIndex
CREATE INDEX "BusinessListingReport_status_createdAt_idx" ON "BusinessListingReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessListingCatalogItem" ADD CONSTRAINT "BusinessListingCatalogItem_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingDailyStat" ADD CONSTRAINT "BusinessListingDailyStat_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingFavorite" ADD CONSTRAINT "BusinessListingFavorite_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingReport" ADD CONSTRAINT "BusinessListingReport_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
