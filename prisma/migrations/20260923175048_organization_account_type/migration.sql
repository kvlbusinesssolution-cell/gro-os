-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('BUSINESS', 'CAREER');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "accountTypeConfirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "type" "OrganizationType" NOT NULL DEFAULT 'BUSINESS';
