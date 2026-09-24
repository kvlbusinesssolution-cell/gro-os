-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DataProvider" ADD VALUE 'COMPANY_WEBSITE_SCRAPE';
ALTER TYPE "DataProvider" ADD VALUE 'FMP';
ALTER TYPE "DataProvider" ADD VALUE 'SEC_EDGAR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceSource" ADD VALUE 'COMPANY_WEBSITE';
ALTER TYPE "EvidenceSource" ADD VALUE 'FMP';
ALTER TYPE "EvidenceSource" ADD VALUE 'SEC_EDGAR';
ALTER TYPE "EvidenceSource" ADD VALUE 'PROSPEO';
