-- CreateEnum
CREATE TYPE "RecruiterMessageMatchStatus" AS ENUM ('MATCHED', 'POSSIBLE_MATCH', 'UNMATCHED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "RecruiterMessageClassificationType" AS ENUM ('INTERVIEW_REQUEST', 'SCREENING', 'MORE_INFORMATION', 'REJECTED', 'OFFER', 'SALARY_DISCUSSION', 'AVAILABILITY_REQUEST', 'DOCUMENT_REQUEST', 'FOLLOW_UP', 'GENERAL_RESPONSE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ClassificationConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NextActionType" AS ENUM ('NO_ACTION', 'CHECK_CALENDAR', 'USER_APPROVAL_REQUIRED', 'REPLY_REQUIRED', 'PROVIDE_INFORMATION', 'UPLOAD_DOCUMENT', 'SCHEDULE_INTERVIEW', 'REQUEST_ALTERNATIVE', 'FOLLOW_UP', 'REVIEW_OFFER', 'REVIEW_REJECTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CareerInterviewStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'SCHEDULED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InterviewDecisionType" AS ENUM ('ACCEPT', 'REJECT', 'SUGGEST_ALTERNATIVE', 'REQUEST_ANOTHER_SLOT');

-- CreateEnum
CREATE TYPE "CareerFollowUpStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'SKIPPED');

-- AlterTable
ALTER TABLE "CareerProfile" ADD COLUMN     "autonomousSchedulingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blackoutPeriods" JSONB,
ADD COLUMN     "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpIntervalDays" INTEGER[] DEFAULT ARRAY[0, 5, 10]::INTEGER[],
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "workingHoursEnd" TEXT,
ADD COLUMN     "workingHoursStart" TEXT,
ADD COLUMN     "workingHoursTimezone" TEXT;

-- CreateTable
CREATE TABLE "RecruiterCommunication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "applicationId" TEXT,
    "matchStatus" "RecruiterMessageMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchEvidence" TEXT,
    "classification" "RecruiterMessageClassificationType" NOT NULL DEFAULT 'UNKNOWN',
    "classificationConfidence" "ClassificationConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "classificationEvidence" TEXT,
    "extraction" JSONB NOT NULL DEFAULT '{}',
    "nextAction" "NextActionType" NOT NULL DEFAULT 'UNKNOWN',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "manualClassification" "RecruiterMessageClassificationType",
    "manuallyClassifiedByUserId" TEXT,
    "manuallyClassifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruiterCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerInterview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sourceCommunicationId" TEXT,
    "status" "CareerInterviewStatus" NOT NULL DEFAULT 'REQUESTED',
    "stage" TEXT,
    "localDate" TEXT,
    "localTime" TEXT,
    "timezone" TEXT,
    "scheduledAtUtc" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "meetingLink" TEXT,
    "phone" TEXT,
    "interviewerName" TEXT,
    "notes" TEXT,
    "preparationNotes" JSONB,
    "calendarProvider" TEXT,
    "calendarEventId" TEXT,
    "calendarSyncStatus" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "idempotencyKey" TEXT,
    "decision" "InterviewDecisionType",
    "decisionByUserId" TEXT,
    "decisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "CareerFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "cancelReason" TEXT,
    "sentEmailDraftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecruiterCommunication_replyId_key" ON "RecruiterCommunication"("replyId");

-- CreateIndex
CREATE INDEX "RecruiterCommunication_organizationId_idx" ON "RecruiterCommunication"("organizationId");

-- CreateIndex
CREATE INDEX "RecruiterCommunication_applicationId_idx" ON "RecruiterCommunication"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerInterview_sourceCommunicationId_key" ON "CareerInterview"("sourceCommunicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerInterview_idempotencyKey_key" ON "CareerInterview"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CareerInterview_organizationId_idx" ON "CareerInterview"("organizationId");

-- CreateIndex
CREATE INDEX "CareerInterview_applicationId_idx" ON "CareerInterview"("applicationId");

-- CreateIndex
CREATE INDEX "CareerInterview_careerProfileId_status_idx" ON "CareerInterview"("careerProfileId", "status");

-- CreateIndex
CREATE INDEX "CareerFollowUp_organizationId_status_scheduledFor_idx" ON "CareerFollowUp"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "CareerFollowUp_applicationId_dayOffset_key" ON "CareerFollowUp"("applicationId", "dayOffset");

-- AddForeignKey
ALTER TABLE "RecruiterCommunication" ADD CONSTRAINT "RecruiterCommunication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterCommunication" ADD CONSTRAINT "RecruiterCommunication_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterCommunication" ADD CONSTRAINT "RecruiterCommunication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerInterview" ADD CONSTRAINT "CareerInterview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerInterview" ADD CONSTRAINT "CareerInterview_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerInterview" ADD CONSTRAINT "CareerInterview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFollowUp" ADD CONSTRAINT "CareerFollowUp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFollowUp" ADD CONSTRAINT "CareerFollowUp_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerFollowUp" ADD CONSTRAINT "CareerFollowUp_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
