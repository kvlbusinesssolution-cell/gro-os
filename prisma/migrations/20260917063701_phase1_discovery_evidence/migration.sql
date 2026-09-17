-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('RAW_FACT', 'AI_INTERPRETATION');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('WEBSITE_SCAN', 'WEB_SEARCH', 'MANUAL', 'CSV_IMPORT', 'COMPANY_INTELLIGENCE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TechnologyCategory" ADD VALUE 'PAYMENT';
ALTER TYPE "TechnologyCategory" ADD VALUE 'BOOKING';
ALTER TYPE "TechnologyCategory" ADD VALUE 'CRM_INDICATOR';
ALTER TYPE "TechnologyCategory" ADD VALUE 'MESSAGING';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "discoverySources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sourceCount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CompanyEvidence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "fact" TEXT NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByAgentId" TEXT,

    CONSTRAINT "CompanyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyEvidence_companyId_idx" ON "CompanyEvidence"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyEvidence" ADD CONSTRAINT "CompanyEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEvidence" ADD CONSTRAINT "CompanyEvidence_generatedByAgentId_fkey" FOREIGN KEY ("generatedByAgentId") REFERENCES "AIAgentInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
