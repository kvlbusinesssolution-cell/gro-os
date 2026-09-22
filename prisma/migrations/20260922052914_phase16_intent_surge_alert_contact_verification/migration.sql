-- CreateEnum
CREATE TYPE "ContactVerificationStatus" AS ENUM ('UNKNOWN', 'VERIFIED', 'UNVERIFIED', 'INVALID', 'RISKY');

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'INTENT_SURGE';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailVerificationStatus" "ContactVerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "phoneVerificationStatus" "ContactVerificationStatus" NOT NULL DEFAULT 'UNKNOWN';
