-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('FREELANCER', 'DIGITAL_AGENCY', 'SEO_AGENCY', 'MARKETING_CONSULTANT', 'IT_CONSULTANT', 'BUSINESS_CONSULTANT', 'DESIGNER', 'TECHNOLOGY_CONSULTANT');

-- CreateEnum
CREATE TYPE "ReferralPartnerStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PartnerCommissionStatus" AS ENUM ('PENDING', 'PAID');

-- AlterEnum
ALTER TYPE "CompanySource" ADD VALUE 'REFERRAL';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "referralPartnerId" TEXT;

-- CreateTable
CREATE TABLE "ReferralPartner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType",
    "status" "ReferralPartnerStatus" NOT NULL DEFAULT 'CANDIDATE',
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "commissionRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "discoverySource" TEXT,
    "discoveryUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCommission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PartnerCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PartnerCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralPartner_organizationId_idx" ON "ReferralPartner"("organizationId");

-- CreateIndex
CREATE INDEX "ReferralPartner_organizationId_status_idx" ON "ReferralPartner"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PartnerCommission_partnerId_status_idx" ON "PartnerCommission"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCommission_partnerId_dealId_key" ON "PartnerCommission"("partnerId", "dealId");

-- CreateIndex
CREATE INDEX "Company_referralPartnerId_idx" ON "Company"("referralPartnerId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_referralPartnerId_fkey" FOREIGN KEY ("referralPartnerId") REFERENCES "ReferralPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
