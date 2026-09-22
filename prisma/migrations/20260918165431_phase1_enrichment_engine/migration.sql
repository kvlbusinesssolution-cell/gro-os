-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('NEVER_ENRICHED', 'QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "EnrichmentEntityType" AS ENUM ('COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "EnrichmentTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'BATCH');

-- CreateEnum
CREATE TYPE "EnrichmentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'RETRYING');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "enrichmentFailureReason" TEXT,
ADD COLUMN     "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'NEVER_ENRICHED',
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "decisionMakerId" TEXT,
ADD COLUMN     "decisionMakerProbability" DOUBLE PRECISION,
ADD COLUMN     "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'NEVER_ENRICHED',
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "EnrichmentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "companyId" TEXT,
    "triggeredBy" "EnrichmentTrigger" NOT NULL,
    "triggeredByUserId" TEXT,
    "status" "EnrichmentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "stepsCompleted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stepsFailed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "factsFound" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentRun_organizationId_idx" ON "EnrichmentRun"("organizationId");

-- CreateIndex
CREATE INDEX "EnrichmentRun_companyId_idx" ON "EnrichmentRun"("companyId");

-- CreateIndex
CREATE INDEX "EnrichmentRun_entityType_entityId_idx" ON "EnrichmentRun"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "EnrichmentRun_status_idx" ON "EnrichmentRun"("status");

-- CreateIndex
CREATE INDEX "Contact_decisionMakerId_idx" ON "Contact"("decisionMakerId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_decisionMakerId_fkey" FOREIGN KEY ("decisionMakerId") REFERENCES "DecisionMaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
