-- CreateEnum
CREATE TYPE "GrowthTokenAction" AS ENUM ('LISTING_PUBLISH', 'DEAL_POST');

-- CreateEnum
CREATE TYPE "GrowthTokenEventStatus" AS ENUM ('SUCCESS', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BusinessListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BusinessDealStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessLeadType" AS ENUM ('CALL_CLICK', 'WHATSAPP_CLICK', 'ENQUIRY_FORM');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "growthTokensMonthly" INTEGER;

-- CreateTable
CREATE TABLE "GrowthTokenLedger" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "monthlyTokensGranted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyTokensUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasedTokensRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodResetAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthTokenLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthTokenUsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "action" "GrowthTokenAction" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "tokensUsed" DOUBLE PRECISION NOT NULL,
    "context" TEXT,
    "status" "GrowthTokenEventStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthTokenUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BusinessListingStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "businessName" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "categories" TEXT[],
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "whatsappNumber" TEXT,
    "contactEmail" TEXT,
    "website" TEXT,
    "openingHours" JSONB,
    "priceRange" TEXT,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListingPhoto" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessListingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessReview" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerEmail" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "status" "BusinessReviewStatus" NOT NULL DEFAULT 'PENDING',
    "ipAddress" TEXT,
    "moderatedByUserId" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDeal" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountLabel" TEXT,
    "termsAndConditions" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" "BusinessDealStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "imageStorageKey" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessListingLead" (
    "id" TEXT NOT NULL,
    "businessListingId" TEXT NOT NULL,
    "businessDealId" TEXT,
    "type" "BusinessLeadType" NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessListingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthTokenLedger_billingAccountId_key" ON "GrowthTokenLedger"("billingAccountId");

-- CreateIndex
CREATE INDEX "GrowthTokenUsageEvent_organizationId_createdAt_idx" ON "GrowthTokenUsageEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "GrowthTokenUsageEvent_billingAccountId_action_idx" ON "GrowthTokenUsageEvent"("billingAccountId", "action");

-- CreateIndex
CREATE INDEX "GrowthTokenUsageEvent_action_status_createdAt_idx" ON "GrowthTokenUsageEvent"("action", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessListing_slug_key" ON "BusinessListing"("slug");

-- CreateIndex
CREATE INDEX "BusinessListing_organizationId_idx" ON "BusinessListing"("organizationId");

-- CreateIndex
CREATE INDEX "BusinessListing_status_publishedAt_idx" ON "BusinessListing"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "BusinessListing_city_category_idx" ON "BusinessListing"("city", "category");

-- CreateIndex
CREATE INDEX "BusinessListingPhoto_businessListingId_sortOrder_idx" ON "BusinessListingPhoto"("businessListingId", "sortOrder");

-- CreateIndex
CREATE INDEX "BusinessReview_businessListingId_status_idx" ON "BusinessReview"("businessListingId", "status");

-- CreateIndex
CREATE INDEX "BusinessReview_status_createdAt_idx" ON "BusinessReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessDeal_businessListingId_status_idx" ON "BusinessDeal"("businessListingId", "status");

-- CreateIndex
CREATE INDEX "BusinessDeal_status_endsAt_idx" ON "BusinessDeal"("status", "endsAt");

-- CreateIndex
CREATE INDEX "BusinessListingLead_businessListingId_createdAt_idx" ON "BusinessListingLead"("businessListingId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessListingLead_businessDealId_idx" ON "BusinessListingLead"("businessDealId");

-- AddForeignKey
ALTER TABLE "GrowthTokenLedger" ADD CONSTRAINT "GrowthTokenLedger_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthTokenUsageEvent" ADD CONSTRAINT "GrowthTokenUsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthTokenUsageEvent" ADD CONSTRAINT "GrowthTokenUsageEvent_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListing" ADD CONSTRAINT "BusinessListing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingPhoto" ADD CONSTRAINT "BusinessListingPhoto_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessReview" ADD CONSTRAINT "BusinessReview_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDeal" ADD CONSTRAINT "BusinessDeal_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingLead" ADD CONSTRAINT "BusinessListingLead_businessListingId_fkey" FOREIGN KEY ("businessListingId") REFERENCES "BusinessListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessListingLead" ADD CONSTRAINT "BusinessListingLead_businessDealId_fkey" FOREIGN KEY ("businessDealId") REFERENCES "BusinessDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
