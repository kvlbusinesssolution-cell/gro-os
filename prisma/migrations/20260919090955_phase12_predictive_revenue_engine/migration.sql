-- CreateEnum
CREATE TYPE "PredictionType" AS ENUM ('DEAL_PROBABILITY', 'EXPECTED_DEAL_VALUE', 'PIPELINE_VALUE', 'WEIGHTED_PIPELINE', 'EXPECTED_REVENUE', 'EXPECTED_DEALS', 'SALES_VELOCITY', 'TIME_TO_CLOSE', 'DEAL_RISK', 'PIPELINE_RISK', 'MONTHLY_REVENUE_FORECAST', 'QUARTERLY_REVENUE_FORECAST', 'REVENUE_RANGE', 'DEAL_CLOSE_DATE', 'PIPELINE_COVERAGE');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'EVALUATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'DEAL_RISK_CRITICAL';
ALTER TYPE "AlertType" ADD VALUE 'PIPELINE_CONCENTRATION_RISK';

-- CreateTable
CREATE TABLE "PredictionSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "predictionType" "PredictionType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "predictionValue" DOUBLE PRECISION,
    "predictionProbability" DOUBLE PRECISION,
    "confidence" "LearningConfidence" NOT NULL,
    "confidenceFactors" JSONB NOT NULL DEFAULT '{}',
    "predictionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forecastPeriod" TEXT,
    "dataCutoffTimestamp" TIMESTAMP(3) NOT NULL,
    "modelMethod" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1',
    "featureVersion" TEXT NOT NULL DEFAULT 'v1',
    "learningVersion" TEXT NOT NULL DEFAULT 'v1',
    "status" "PredictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "actualValue" DOUBLE PRECISION,
    "actualOutcome" TEXT,
    "accuracy" JSONB,
    "currency" TEXT,
    "lowerBound" DOUBLE PRECISION,
    "upperBound" DOUBLE PRECISION,
    "explanation" TEXT,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStageHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "fromStageName" TEXT,
    "toStageId" TEXT NOT NULL,
    "toStageName" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,

    CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastCalibration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'DEAL_PROBABILITY',
    "sampleSize" INTEGER NOT NULL,
    "bandsJson" JSONB NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PredictionSnapshot_organizationId_entityType_entityId_predi_idx" ON "PredictionSnapshot"("organizationId", "entityType", "entityId", "predictionType", "status");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_organizationId_predictionType_forecastPe_idx" ON "PredictionSnapshot"("organizationId", "predictionType", "forecastPeriod", "status");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_organizationId_predictionDate_idx" ON "PredictionSnapshot"("organizationId", "predictionDate");

-- CreateIndex
CREATE INDEX "DealStageHistory_organizationId_dealId_changedAt_idx" ON "DealStageHistory"("organizationId", "dealId", "changedAt");

-- CreateIndex
CREATE INDEX "DealStageHistory_organizationId_toStageName_idx" ON "DealStageHistory"("organizationId", "toStageName");

-- CreateIndex
CREATE INDEX "ForecastCalibration_organizationId_subject_computedAt_idx" ON "ForecastCalibration"("organizationId", "subject", "computedAt");

-- AddForeignKey
ALTER TABLE "PredictionSnapshot" ADD CONSTRAINT "PredictionSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastCalibration" ADD CONSTRAINT "ForecastCalibration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
