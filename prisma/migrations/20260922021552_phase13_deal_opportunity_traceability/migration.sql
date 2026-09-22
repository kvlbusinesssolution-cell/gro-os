-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "sourceOpportunityId" TEXT;

-- CreateIndex
CREATE INDEX "Deal_sourceOpportunityId_idx" ON "Deal"("sourceOpportunityId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "LeadOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
