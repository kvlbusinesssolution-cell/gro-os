-- CreateEnum
CREATE TYPE "RateNegotiationStatus" AS ENUM ('AWAITING_OWNER', 'OWNER_RESPONDED', 'CLIENT_REPLIED');

-- AlterTable
ALTER TABLE "LeadOpportunity" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "RateNegotiation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "clientMessage" TEXT NOT NULL,
    "scopeSummary" TEXT NOT NULL,
    "recommendedRateINR" INTEGER,
    "recommendationReasoning" TEXT NOT NULL,
    "status" "RateNegotiationStatus" NOT NULL DEFAULT 'AWAITING_OWNER',
    "ownerEmailSentAt" TIMESTAMP(3),
    "ownerReplyContent" TEXT,
    "ownerRespondedAt" TIMESTAMP(3),
    "clientReplyDraftId" TEXT,
    "outreachMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateNegotiation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateNegotiation_replyId_key" ON "RateNegotiation"("replyId");

-- CreateIndex
CREATE INDEX "RateNegotiation_organizationId_status_idx" ON "RateNegotiation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RateNegotiation_companyId_idx" ON "RateNegotiation"("companyId");

-- AddForeignKey
ALTER TABLE "RateNegotiation" ADD CONSTRAINT "RateNegotiation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateNegotiation" ADD CONSTRAINT "RateNegotiation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateNegotiation" ADD CONSTRAINT "RateNegotiation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateNegotiation" ADD CONSTRAINT "RateNegotiation_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
