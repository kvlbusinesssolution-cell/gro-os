-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DISCOVERED', 'MATCHED', 'SHORTLISTED', 'PREPARING', 'READY_FOR_REVIEW', 'USER_APPROVAL_REQUIRED', 'PLATFORM_RESTRICTED', 'SUBMITTING', 'SUBMITTED', 'SUBMITTED_UNCONFIRMED', 'CONFIRMED', 'FAILED', 'FAILED_REQUIRES_REVIEW', 'REJECTED', 'WITHDRAWN', 'INTERVIEW', 'OFFER', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationAutomationMode" AS ENUM ('DISCOVERY_ONLY', 'AI_PREPARE', 'APPLY_WITH_APPROVAL', 'AUTO_APPLY_APPROVED', 'FULL_AUTONOMOUS');

-- CreateEnum
CREATE TYPE "ApplicationEligibilityStatus" AS ENUM ('ELIGIBLE', 'LIKELY_ELIGIBLE', 'REVIEW_REQUIRED', 'LIKELY_NOT_ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationDuplicateStatus" AS ENUM ('NO_DUPLICATE', 'DUPLICATE_CONFIRMED', 'POSSIBLE_DUPLICATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationSubmissionMethod" AS ENUM ('API', 'AUTHORIZED_BROWSER', 'EMPLOYER_PORTAL', 'USER_ACTION_REQUIRED', 'EMAIL', 'OTHER_SUPPORTED_INTEGRATION');

-- CreateEnum
CREATE TYPE "ApplicationAnswerSource" AS ENUM ('USER_VERIFIED', 'RESUME', 'CAREER_PROFILE', 'USER_PREFERENCE', 'JOB_SOURCE', 'USER_INPUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationAnswerStatus" AS ENUM ('VERIFIED', 'REVIEW_REQUIRED', 'USER_INPUT_REQUIRED');

-- CreateEnum
CREATE TYPE "ApplicationDocumentType" AS ENUM ('CUSTOMIZED_RESUME', 'COVER_LETTER', 'RECRUITER_EMAIL', 'HIRING_MANAGER_EMAIL', 'LINKEDIN_DRAFT', 'PORTFOLIO_SELECTION');

-- CreateEnum
CREATE TYPE "ApplicationSuspicionStatus" AS ENUM ('NOT_SUSPICIOUS', 'SUSPICIOUS', 'REVIEW_REQUIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationValidationResult" AS ENUM ('READY', 'BLOCKED', 'REVIEW_REQUIRED');

-- AlterEnum
ALTER TYPE "DraftPurpose" ADD VALUE 'JOB_APPLICATION';

-- AlterTable
ALTER TABLE "CareerProfile" ADD COLUMN     "applicationAutomationMode" "ApplicationAutomationMode" NOT NULL DEFAULT 'DISCOVERY_ONLY',
ADD COLUMN     "applicationRequireApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxApplicationsPerDay" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxApplicationsPerWeek" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "minEligibilityForAutoApply" "ApplicationEligibilityStatus" NOT NULL DEFAULT 'LIKELY_ELIGIBLE';

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobMatchId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DISCOVERED',
    "automationModeAtCreation" "ApplicationAutomationMode" NOT NULL,
    "duplicateStatus" "ApplicationDuplicateStatus" NOT NULL DEFAULT 'UNKNOWN',
    "eligibilityStatus" "ApplicationEligibilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "eligibilityDetail" JSONB,
    "suspicionStatus" "ApplicationSuspicionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "suspicionEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedResumeId" TEXT,
    "selectedResumeReason" TEXT,
    "validationResult" "ApplicationValidationResult",
    "validationDetail" JSONB,
    "policyDecision" JSONB,
    "blockedReason" TEXT,
    "submissionMethod" "ApplicationSubmissionMethod",
    "submissionAttemptId" TEXT,
    "providerRequestId" TEXT,
    "providerConfirmationId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "submittingAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "interviewDetectedAt" TIMESTAMP(3),
    "offerDetectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "source" "ApplicationAnswerSource" NOT NULL DEFAULT 'UNKNOWN',
    "status" "ApplicationAnswerStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "ApplicationDocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT,
    "content" TEXT,
    "sourceResumeVersion" INTEGER,
    "validationResult" JSONB,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobMatchId_key" ON "JobApplication"("jobMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_submissionAttemptId_key" ON "JobApplication"("submissionAttemptId");

-- CreateIndex
CREATE INDEX "JobApplication_organizationId_status_idx" ON "JobApplication"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JobApplication_userId_idx" ON "JobApplication"("userId");

-- CreateIndex
CREATE INDEX "JobApplication_careerProfileId_status_idx" ON "JobApplication"("careerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_careerProfileId_jobId_key" ON "JobApplication"("careerProfileId", "jobId");

-- CreateIndex
CREATE INDEX "ApplicationAnswer_applicationId_idx" ON "ApplicationAnswer"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_providerMessageId_key" ON "ApplicationDocument"("providerMessageId");

-- CreateIndex
CREATE INDEX "ApplicationDocument_applicationId_type_idx" ON "ApplicationDocument"("applicationId", "type");

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobMatchId_fkey" FOREIGN KEY ("jobMatchId") REFERENCES "JobMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_selectedResumeId_fkey" FOREIGN KEY ("selectedResumeId") REFERENCES "CareerResume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
