-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "linkedEmailDraftId" TEXT;

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Document_linkedEmailDraftId_idx" ON "Document"("linkedEmailDraftId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_linkedEmailDraftId_fkey" FOREIGN KEY ("linkedEmailDraftId") REFERENCES "EmailDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
