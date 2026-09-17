-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'REVIEWED', 'ADDED_TO_CRM', 'DISMISSED');

-- AlterTable
-- `updatedAt` given a real DEFAULT CURRENT_TIMESTAMP (Prisma's own generated
-- SQL omitted one, which is fine against an empty table but would hard-fail
-- with "column contains null values" against any table with existing rows —
-- confirmed a real risk before deploying to production, fixed here rather
-- than assuming production's LeadOpportunity table is empty). Prisma's
-- @updatedAt directive still sets this explicitly on every future
-- create/update at the application layer, so the DB-level default only
-- matters for backfilling whatever rows already exist at migration time.
ALTER TABLE "LeadOpportunity" ADD COLUMN     "recommendedService" TEXT,
ADD COLUMN     "serviceMatchReason" TEXT,
ADD COLUMN     "serviceMatchScore" INTEGER,
ADD COLUMN     "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
