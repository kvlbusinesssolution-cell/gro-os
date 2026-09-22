-- CreateEnum
CREATE TYPE "AttributionType" AS ENUM ('DIRECT', 'ASSISTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttributionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "RevenueAttribution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "dealId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "proposalId" TEXT,
    "meetingId" TEXT,
    "replyId" TEXT,
    "emailDraftId" TEXT,
    "campaignId" TEXT,
    "sequenceId" TEXT,
    "source" "CompanySource",
    "attributionType" "AttributionType" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" "AttributionConfidence" NOT NULL DEFAULT 'LOW',
    "attributionRule" TEXT NOT NULL,
    "attributionModel" TEXT NOT NULL DEFAULT 'v1',
    "revenueAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "touchpoints" JSONB NOT NULL DEFAULT '[]',
    "dataQualityFlags" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevenueAttribution_organizationId_idx" ON "RevenueAttribution"("organizationId");

-- CreateIndex
CREATE INDEX "RevenueAttribution_organizationId_attributionType_idx" ON "RevenueAttribution"("organizationId", "attributionType");

-- CreateIndex
CREATE INDEX "RevenueAttribution_dealId_idx" ON "RevenueAttribution"("dealId");

-- CreateIndex
CREATE INDEX "RevenueAttribution_companyId_idx" ON "RevenueAttribution"("companyId");

-- CreateIndex
CREATE INDEX "RevenueAttribution_campaignId_idx" ON "RevenueAttribution"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueAttribution_organizationId_invoiceId_attributionMode_key" ON "RevenueAttribution"("organizationId", "invoiceId", "attributionModel");

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
