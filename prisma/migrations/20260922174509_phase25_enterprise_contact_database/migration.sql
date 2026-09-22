-- CreateEnum
CREATE TYPE "ContactBuyerRole" AS ENUM ('ECONOMIC_BUYER', 'TECHNICAL_BUYER', 'BUSINESS_BUYER', 'INFLUENCER', 'CHAMPION', 'EXECUTIVE', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "ContactVerificationStatus" ADD VALUE 'STALE';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "buyerRole" "ContactBuyerRole" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "seniority" TEXT;

-- CreateTable
CREATE TABLE "ContactEvidence" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "fact" TEXT NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fieldName" TEXT,
    "verificationStatus" "EvidenceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',

    CONSTRAINT "ContactEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactEvidence_contactId_idx" ON "ContactEvidence"("contactId");

-- CreateIndex
CREATE INDEX "ContactEvidence_contactId_fieldName_idx" ON "ContactEvidence"("contactId", "fieldName");

-- CreateIndex
CREATE INDEX "Contact_mergedIntoId_idx" ON "Contact"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_email_key" ON "Contact"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

