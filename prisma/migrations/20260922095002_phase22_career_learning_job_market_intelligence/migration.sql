-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LearningRecommendationCategory" ADD VALUE 'CV_VERSION';
ALTER TYPE "LearningRecommendationCategory" ADD VALUE 'SKILL_DEVELOPMENT';
ALTER TYPE "LearningRecommendationCategory" ADD VALUE 'JOB_PRIORITIZATION';
ALTER TYPE "LearningRecommendationCategory" ADD VALUE 'APPLICATION_TIMING';
ALTER TYPE "LearningRecommendationCategory" ADD VALUE 'SOURCE_MONITORING';

-- AlterTable
ALTER TABLE "LearningRecommendation" ADD COLUMN     "careerProfileId" TEXT;

-- CreateTable
CREATE TABLE "JobMarketSnapshot" (
    "id" TEXT NOT NULL,
    "sources" TEXT[],
    "geography" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "collectionPeriodStart" TIMESTAMP(3) NOT NULL,
    "collectionPeriodEnd" TIMESTAMP(3) NOT NULL,
    "skillDistribution" JSONB NOT NULL DEFAULT '[]',
    "technologyDistribution" JSONB NOT NULL DEFAULT '[]',
    "roleDistribution" JSONB NOT NULL DEFAULT '[]',
    "industryDistribution" JSONB NOT NULL DEFAULT '[]',
    "workModeDistribution" JSONB NOT NULL DEFAULT '[]',
    "locationDistribution" JSONB NOT NULL DEFAULT '[]',
    "experienceDistribution" JSONB NOT NULL DEFAULT '[]',
    "salaryObservations" JSONB NOT NULL DEFAULT '[]',
    "sourceQuality" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMarketSnapshot_geography_createdAt_idx" ON "JobMarketSnapshot"("geography", "createdAt");

-- CreateIndex
CREATE INDEX "JobMarketSnapshot_createdAt_idx" ON "JobMarketSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "LearningRecommendation_careerProfileId_idx" ON "LearningRecommendation"("careerProfileId");
