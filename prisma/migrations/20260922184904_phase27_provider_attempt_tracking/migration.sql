-- CreateEnum
CREATE TYPE "AIUsageStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "AIUsageEvent" ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "status" "AIUsageStatus" NOT NULL DEFAULT 'SUCCESS';

-- CreateIndex
CREATE INDEX "AIUsageEvent_provider_status_createdAt_idx" ON "AIUsageEvent"("provider", "status", "createdAt");
