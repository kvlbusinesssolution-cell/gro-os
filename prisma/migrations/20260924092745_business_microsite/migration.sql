-- CreateEnum
CREATE TYPE "BusinessMicrositeStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "GrowthTokenAction" ADD VALUE 'MICROSITE_PUBLISH';

-- CreateTable
CREATE TABLE "BusinessMicrosite" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BusinessMicrositeStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMicrosite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMicrositePage" (
    "id" TEXT NOT NULL,
    "micrositeId" TEXT NOT NULL,
    "pageSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyBlocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMicrositePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMicrosite_businessListingId_key" ON "BusinessMicrosite"("businessListingId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMicrosite_slug_key" ON "BusinessMicrosite"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMicrositePage_micrositeId_pageSlug_key" ON "BusinessMicrositePage"("micrositeId", "pageSlug");

-- AddForeignKey
ALTER TABLE "BusinessMicrosite" ADD CONSTRAINT "BusinessMicrosite_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMicrositePage" ADD CONSTRAINT "BusinessMicrositePage_micrositeId_fkey" FOREIGN KEY ("micrositeId") REFERENCES "BusinessMicrosite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
