-- CreateEnum
CREATE TYPE "CareerProfileStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CareerWorkMode" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'ANY');

-- CreateEnum
CREATE TYPE "CareerEmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "CareerRelocationPreference" AS ENUM ('WILLING', 'UNWILLING', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "CareerResumeStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALID', 'INVALID', 'PARSING', 'PARSED', 'AI_PROCESSING', 'PROCESSED', 'REVIEW_REQUIRED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "CareerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "CareerProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentRole" TEXT,
    "careerLevel" TEXT,
    "yearsOfExperience" DOUBLE PRECISION,
    "location" TEXT,
    "industries" TEXT[],
    "skills" JSONB,
    "education" JSONB,
    "certifications" JSONB,
    "projects" JSONB,
    "achievements" JSONB,
    "portfolioUrl" TEXT,
    "githubUrl" TEXT,
    "linkedinUrl" TEXT,
    "websiteUrl" TEXT,
    "targetRoles" TEXT[],
    "targetCountries" TEXT[],
    "targetCities" TEXT[],
    "workMode" "CareerWorkMode",
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "salaryCurrency" TEXT,
    "employmentTypes" "CareerEmploymentType"[],
    "experienceLevelMinYears" INTEGER,
    "experienceLevelMaxYears" INTEGER,
    "preferredTechnologies" TEXT[],
    "excludedTechnologies" TEXT[],
    "preferredCompanies" TEXT[],
    "excludedCompanies" TEXT[],
    "relocationPreference" "CareerRelocationPreference",
    "noticePeriodDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerResume" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "CareerResumeStatus" NOT NULL DEFAULT 'UPLOADED',
    "failureReason" TEXT,
    "extractedText" TEXT,
    "aiExtractedProfile" JSONB,
    "aiConfidence" TEXT,
    "userVerifiedFields" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CareerResume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerProfile_userId_idx" ON "CareerProfile"("userId");

-- CreateIndex
CREATE INDEX "CareerProfile_organizationId_idx" ON "CareerProfile"("organizationId");

-- CreateIndex
CREATE INDEX "CareerResume_careerProfileId_version_idx" ON "CareerResume"("careerProfileId", "version");

-- CreateIndex
CREATE INDEX "CareerResume_careerProfileId_checksum_idx" ON "CareerResume"("careerProfileId", "checksum");

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerResume" ADD CONSTRAINT "CareerResume_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
