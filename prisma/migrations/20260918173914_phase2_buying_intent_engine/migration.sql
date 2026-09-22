-- CreateEnum
CREATE TYPE "BuyingStage" AS ENUM ('UNKNOWN', 'TARGET', 'AWARENESS', 'CONSIDERATION', 'DECISION', 'NEGOTIATION', 'CUSTOMER', 'LOST');

-- AlterTable
ALTER TABLE "IntentScore" ADD COLUMN     "buyingStage" "BuyingStage" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "buyingStageConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "buyingStageReasoning" TEXT NOT NULL DEFAULT 'Not yet classified.';

-- CreateTable
CREATE TABLE "IntentScoreHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "previousScore" INTEGER,
    "newScore" INTEGER NOT NULL,
    "scoreChange" INTEGER NOT NULL,
    "previousBand" "IntentBand",
    "newBand" "IntentBand" NOT NULL,
    "previousStage" "BuyingStage",
    "newStage" "BuyingStage" NOT NULL,
    "reason" TEXT NOT NULL,
    "triggerSignal" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntentScoreHistory_organizationId_idx" ON "IntentScoreHistory"("organizationId");

-- CreateIndex
CREATE INDEX "IntentScoreHistory_companyId_calculatedAt_idx" ON "IntentScoreHistory"("companyId", "calculatedAt");

-- AddForeignKey
ALTER TABLE "IntentScoreHistory" ADD CONSTRAINT "IntentScoreHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
