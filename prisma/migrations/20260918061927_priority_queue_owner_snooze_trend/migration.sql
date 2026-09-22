-- AlterTable
ALTER TABLE "LeadOpportunity" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "previousOpportunityScore" INTEGER,
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LeadOpportunity_ownerUserId_idx" ON "LeadOpportunity"("ownerUserId");

-- AddForeignKey
ALTER TABLE "LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
