-- CreateEnum
CREATE TYPE "DataProvider" AS ENUM ('HUNTER_IO', 'ABSTRACT_EMAIL_VALIDATION', 'OPENCORPORATES', 'UK_COMPANIES_HOUSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceSource" ADD VALUE 'OPENCORPORATES';
ALTER TYPE "EvidenceSource" ADD VALUE 'UK_COMPANIES_HOUSE';

-- CreateTable
CREATE TABLE "DataProviderCallLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL,
    "target" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "resultSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataProviderCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataProviderCallLog_provider_createdAt_idx" ON "DataProviderCallLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "DataProviderCallLog_organizationId_provider_createdAt_idx" ON "DataProviderCallLog"("organizationId", "provider", "createdAt");

-- AddForeignKey
ALTER TABLE "DataProviderCallLog" ADD CONSTRAINT "DataProviderCallLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
