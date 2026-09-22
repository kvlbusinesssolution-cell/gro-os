/*
  Warnings:

  - Made the column `organizationId` on table `SendingIdentity` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organizationId` on table `SuppressionEntry` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "SendingIdentity" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "SuppressionEntry" ALTER COLUMN "organizationId" SET NOT NULL;
