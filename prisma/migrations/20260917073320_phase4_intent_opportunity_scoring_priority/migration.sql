-- CreateEnum
CREATE TYPE "IntentBand" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('HOT', 'HIGH', 'MEDIUM', 'NURTURE', 'LOW', 'DISQUALIFIED');

-- AlterTable
ALTER TABLE "LeadOpportunity" ADD COLUMN     "opportunityScore" INTEGER,
ADD COLUMN     "opportunityScoreBreakdown" JSONB,
ADD COLUMN     "priority" "OpportunityPriority",
ADD COLUMN     "priorityReasoning" TEXT;

-- CreateTable
CREATE TABLE "IntentScore" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "IntentBand" NOT NULL,
    "signals" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntentScore_companyId_key" ON "IntentScore"("companyId");

-- CreateIndex
CREATE INDEX "IntentScore_companyId_idx" ON "IntentScore"("companyId");

-- AddForeignKey
ALTER TABLE "IntentScore" ADD CONSTRAINT "IntentScore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
