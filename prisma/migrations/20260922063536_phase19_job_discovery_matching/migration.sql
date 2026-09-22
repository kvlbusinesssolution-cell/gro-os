-- CreateEnum
CREATE TYPE "CareerDiscoveryFrequency" AS ENUM ('MANUAL_ONLY', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CareerJobStatus" AS ENUM ('DISCOVERED', 'MATCHED', 'SHORTLISTED', 'NOT_MATCHED', 'REVIEW_REQUIRED', 'CLOSED', 'EXPIRED', 'REMOVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CareerJobEligibility" AS ENUM ('LIKELY_ELIGIBLE', 'POSSIBLE', 'REVIEW_REQUIRED', 'LIKELY_NOT_ELIGIBLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CareerDiscoveryTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "CareerDiscoveryRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL', 'RATE_LIMITED', 'NOT_CONFIGURED');

-- AlterTable
ALTER TABLE "CareerProfile" ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discoveryFrequency" "CareerDiscoveryFrequency" NOT NULL DEFAULT 'MANUAL_ONLY',
ADD COLUMN     "minMatchThreshold" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "companyDomain" TEXT,
    "location" TEXT,
    "country" TEXT,
    "city" TEXT,
    "workMode" "CareerWorkMode",
    "description" TEXT NOT NULL,
    "requirements" JSONB,
    "responsibilities" TEXT[],
    "technologies" TEXT[],
    "industry" TEXT,
    "careerLevel" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "salaryCurrency" TEXT,
    "salaryPeriod" TEXT,
    "employmentType" "CareerEmploymentType",
    "experienceMinYears" INTEGER,
    "experienceMaxYears" INTEGER,
    "status" "CareerJobStatus" NOT NULL DEFAULT 'DISCOVERED',
    "postingDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canonicalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSourceRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rawSnapshot" JSONB NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMatch" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "dimensions" JSONB NOT NULL,
    "eligibility" "CareerJobEligibility" NOT NULL DEFAULT 'UNKNOWN',
    "explanation" JSONB,
    "status" "CareerJobStatus" NOT NULL DEFAULT 'DISCOVERED',
    "userNotes" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDiscoveryRun" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "triggeredBy" "CareerDiscoveryTrigger" NOT NULL,
    "status" "CareerDiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "newJobsCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatesCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_canonicalUrl_key" ON "Job"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_company_idx" ON "Job"("company");

-- CreateIndex
CREATE INDEX "Job_lastSeenAt_idx" ON "Job"("lastSeenAt");

-- CreateIndex
CREATE INDEX "JobSourceRecord_jobId_idx" ON "JobSourceRecord"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSourceRecord_provider_sourceJobId_key" ON "JobSourceRecord"("provider", "sourceJobId");

-- CreateIndex
CREATE INDEX "JobMatch_careerProfileId_status_idx" ON "JobMatch"("careerProfileId", "status");

-- CreateIndex
CREATE INDEX "JobMatch_organizationId_idx" ON "JobMatch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMatch_careerProfileId_jobId_key" ON "JobMatch"("careerProfileId", "jobId");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_careerProfileId_startedAt_idx" ON "JobDiscoveryRun"("careerProfileId", "startedAt");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_organizationId_idx" ON "JobDiscoveryRun"("organizationId");

-- AddForeignKey
ALTER TABLE "JobSourceRecord" ADD CONSTRAINT "JobSourceRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
