-- CreateEnum
CREATE TYPE "LearningOutcome" AS ENUM ('FOUND', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'MEETING', 'PROPOSAL', 'WON', 'LOST', 'NO_RESPONSE', 'DISQUALIFIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LearningConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LearningSampleClassification" AS ENUM ('INSUFFICIENT_DATA', 'LOW_SAMPLE', 'EMERGING', 'OBSERVED', 'STRONG_OBSERVATION');

-- CreateEnum
CREATE TYPE "LearningPatternStatus" AS ENUM ('EMERGING', 'ACTIVE', 'WEAKENING', 'STALE', 'RETIRED');

-- CreateEnum
CREATE TYPE "LearningPatternType" AS ENUM ('WINNING_PATTERN', 'LOSING_PATTERN', 'SIGNAL', 'MESSAGE_ANGLE', 'SERVICE', 'CHANNEL', 'DECISION_MAKER', 'HIGH_VALUE', 'LONG_SALES_CYCLE', 'SHORT_SALES_CYCLE', 'OBJECTION');

-- CreateEnum
CREATE TYPE "LearningRecommendationCategory" AS ENUM ('PRIORITY', 'INTENT', 'OUTREACH', 'RESEARCH', 'SERVICE_MATCHING', 'FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "LearningRecommendationStatus" AS ENUM ('PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "LearningHealthStatus" AS ENUM ('HEALTHY', 'LIMITED_DATA', 'STALE', 'INSUFFICIENT_DATA', 'ERROR');

-- CreateTable
CREATE TABLE "LearningObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "decisionMakerId" TEXT,
    "leadOpportunityId" TEXT,
    "dealId" TEXT,
    "proposalId" TEXT,
    "meetingId" TEXT,
    "replyId" TEXT,
    "campaignId" TEXT,
    "sequenceId" TEXT,
    "revenueAttributionId" TEXT,
    "channel" "DraftChannel",
    "service" TEXT,
    "country" TEXT,
    "industry" TEXT,
    "companySize" INTEGER,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intentScore" DOUBLE PRECISION,
    "intentBand" TEXT,
    "intentSignals" JSONB NOT NULL DEFAULT '[]',
    "decisionMakerRole" TEXT,
    "messageAngle" TEXT,
    "dealSize" DOUBLE PRECISION,
    "salesCycleDays" INTEGER,
    "objections" JSONB NOT NULL DEFAULT '[]',
    "leadSource" "CompanySource",
    "outcome" "LearningOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "revenue" DOUBLE PRECISION,
    "stageTimestamps" JSONB NOT NULL DEFAULT '{}',
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "aiProvider" TEXT,
    "predictionTimestamp" TIMESTAMP(3),
    "actualOutcomeTimestamp" TIMESTAMP(3),
    "datasetVersion" TEXT NOT NULL DEFAULT 'v1',
    "analysisVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPattern" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patternType" "LearningPatternType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "cohort" JSONB NOT NULL DEFAULT '{}',
    "sampleSize" INTEGER NOT NULL,
    "positiveOutcomes" INTEGER NOT NULL,
    "negativeOutcomes" INTEGER NOT NULL,
    "conversionRate" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "avgDealSize" DOUBLE PRECISION,
    "medianDealSize" DOUBLE PRECISION,
    "avgSalesCycleDays" DOUBLE PRECISION,
    "medianSalesCycleDays" DOUBLE PRECISION,
    "timePeriodStart" TIMESTAMP(3) NOT NULL,
    "timePeriodEnd" TIMESTAMP(3) NOT NULL,
    "confidence" "LearningConfidence" NOT NULL,
    "confidenceFactors" JSONB NOT NULL DEFAULT '{}',
    "sampleClassification" "LearningSampleClassification" NOT NULL,
    "minSampleThreshold" INTEGER NOT NULL,
    "causality" TEXT NOT NULL DEFAULT 'NOT_ESTABLISHED',
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "LearningPatternStatus" NOT NULL DEFAULT 'EMERGING',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3),
    "lastObservedAt" TIMESTAMP(3),
    "trend" TEXT,
    "computedByRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningRecommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "LearningRecommendationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "currentRule" TEXT NOT NULL,
    "suggestedChange" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidencePatternIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sampleSize" INTEGER NOT NULL,
    "confidence" "LearningConfidence" NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "affectedSystem" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" "LearningRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "implementationVersion" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningShadowScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadOpportunityId" TEXT NOT NULL,
    "productionScore" INTEGER NOT NULL,
    "shadowScore" INTEGER NOT NULL,
    "scoreDiff" INTEGER NOT NULL,
    "basisPatternIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningShadowScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningEngineState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "datasetVersion" TEXT NOT NULL DEFAULT 'v1',
    "analysisVersion" TEXT NOT NULL DEFAULT 'v1',
    "lastRunId" TEXT,
    "status" "LearningHealthStatus" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "totalObservations" INTEGER NOT NULL DEFAULT 0,
    "verifiedOutcomeCount" INTEGER NOT NULL DEFAULT 0,
    "unknownOutcomeCount" INTEGER NOT NULL DEFAULT 0,
    "patternsDetected" INTEGER NOT NULL DEFAULT 0,
    "patternsSufficientData" INTEGER NOT NULL DEFAULT 0,
    "patternsInsufficientData" INTEGER NOT NULL DEFAULT 0,
    "recommendationsPending" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningEngineState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningObservation_organizationId_outcome_idx" ON "LearningObservation"("organizationId", "outcome");

-- CreateIndex
CREATE INDEX "LearningObservation_organizationId_createdAt_idx" ON "LearningObservation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningObservation_companyId_idx" ON "LearningObservation"("companyId");

-- CreateIndex
CREATE INDEX "LearningObservation_leadOpportunityId_idx" ON "LearningObservation"("leadOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObservation_organizationId_companyId_leadOpportunit_key" ON "LearningObservation"("organizationId", "companyId", "leadOpportunityId");

-- CreateIndex
CREATE INDEX "LearningPattern_organizationId_patternType_idx" ON "LearningPattern"("organizationId", "patternType");

-- CreateIndex
CREATE INDEX "LearningPattern_organizationId_status_idx" ON "LearningPattern"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LearningPattern_organizationId_sampleClassification_idx" ON "LearningPattern"("organizationId", "sampleClassification");

-- CreateIndex
CREATE INDEX "LearningRecommendation_organizationId_status_idx" ON "LearningRecommendation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LearningRecommendation_organizationId_category_idx" ON "LearningRecommendation"("organizationId", "category");

-- CreateIndex
CREATE INDEX "LearningShadowScore_organizationId_leadOpportunityId_idx" ON "LearningShadowScore"("organizationId", "leadOpportunityId");

-- CreateIndex
CREATE INDEX "LearningShadowScore_organizationId_computedAt_idx" ON "LearningShadowScore"("organizationId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEngineState_organizationId_key" ON "LearningEngineState"("organizationId");

-- AddForeignKey
ALTER TABLE "LearningObservation" ADD CONSTRAINT "LearningObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPattern" ADD CONSTRAINT "LearningPattern_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRecommendation" ADD CONSTRAINT "LearningRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningShadowScore" ADD CONSTRAINT "LearningShadowScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEngineState" ADD CONSTRAINT "LearningEngineState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
