
-- CreateEnum
CREATE TYPE "EvidenceVerificationStatus" AS ENUM ('UNVERIFIED', 'USER_VERIFIED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "companyAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "employeeGrowthRate" DOUBLE PRECISION,
ADD COLUMN     "fundingDate" TIMESTAMP(3),
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "parentCompanyId" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "revenueMax" DOUBLE PRECISION,
ADD COLUMN     "revenueMin" DOUBLE PRECISION,
ADD COLUMN     "subindustry" TEXT;

-- AlterTable
ALTER TABLE "CompanyEvidence" ADD COLUMN     "fieldName" TEXT,
ADD COLUMN     "verificationStatus" "EvidenceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateIndex
CREATE INDEX "Company_parentCompanyId_idx" ON "Company"("parentCompanyId");

-- CreateIndex
CREATE INDEX "Company_mergedIntoId_idx" ON "Company"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_organizationId_domain_key" ON "Company"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "CompanyEvidence_companyId_fieldName_idx" ON "CompanyEvidence"("companyId", "fieldName");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

