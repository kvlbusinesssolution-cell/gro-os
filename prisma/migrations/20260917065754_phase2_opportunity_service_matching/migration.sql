/*
  Warnings:

  - Added the required column `updatedAt` to the `LeadOpportunity` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'REVIEWED', 'ADDED_TO_CRM', 'DISMISSED');

-- AlterTable
ALTER TABLE "LeadOpportunity" ADD COLUMN     "recommendedService" TEXT,
ADD COLUMN     "serviceMatchReason" TEXT,
ADD COLUMN     "serviceMatchScore" INTEGER,
ADD COLUMN     "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
