-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cc" TEXT[] DEFAULT ARRAY[]::TEXT[];
