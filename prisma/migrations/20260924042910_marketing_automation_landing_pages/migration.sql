-- CreateEnum
CREATE TYPE "MarketingLandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- AlterEnum
ALTER TYPE "GrowthTokenAction" ADD VALUE 'LANDING_PAGE_PUBLISH';

-- CreateTable
CREATE TABLE "MarketingLandingPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "MarketingLandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "heroImageUrl" TEXT,
    "bodyBlocks" JSONB NOT NULL,
    "formFields" JSONB NOT NULL,
    "leadMagnetAssetKey" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLandingPageLead" (
    "id" TEXT NOT NULL,
    "marketingLandingPageId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "rawFieldData" JSONB NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLandingPageLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLandingPage_slug_key" ON "MarketingLandingPage"("slug");

-- CreateIndex
CREATE INDEX "MarketingLandingPage_organizationId_idx" ON "MarketingLandingPage"("organizationId");

-- CreateIndex
CREATE INDEX "MarketingLandingPage_status_idx" ON "MarketingLandingPage"("status");

-- CreateIndex
CREATE INDEX "MarketingLandingPageLead_marketingLandingPageId_createdAt_idx" ON "MarketingLandingPageLead"("marketingLandingPageId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLandingPageLead_contactId_idx" ON "MarketingLandingPageLead"("contactId");

-- AddForeignKey
ALTER TABLE "MarketingLandingPage" ADD CONSTRAINT "MarketingLandingPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLandingPageLead" ADD CONSTRAINT "MarketingLandingPageLead_marketingLandingPageId_fkey" FOREIGN KEY ("marketingLandingPageId") REFERENCES "MarketingLandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLandingPageLead" ADD CONSTRAINT "MarketingLandingPageLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
