-- CreateEnum
CREATE TYPE "VoiceConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VoiceRecordingConsent" AS ENUM ('RECORDING_ALLOWED', 'RECORDING_REQUIRES_CONSENT', 'RECORDING_NOT_ALLOWED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "CallEligibilityStatus" AS ENUM ('ELIGIBLE', 'CONSENT_REQUIRED', 'DO_NOT_CALL', 'OPTED_OUT', 'INVALID_NUMBER', 'OUTSIDE_ALLOWED_TIME', 'PROVIDER_RESTRICTED', 'JURISDICTION_RESTRICTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('CALL_REQUESTED', 'RINGING', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'CALLBACK', 'MEETING_REQUESTED', 'QUALIFIED', 'DISQUALIFIED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallOutcomeSetBy" AS ENUM ('PROVIDER_STATUS', 'HUMAN', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "CallTranscriptStatus" AS ENUM ('TRANSCRIPT_AVAILABLE', 'TRANSCRIPT_NOT_AVAILABLE', 'TRANSCRIPT_NOT_PERMITTED', 'TRANSCRIPT_FAILED');

-- AlterEnum
ALTER TYPE "DraftChannel" ADD VALUE 'VOICE';

-- CreateTable
CREATE TABLE "VoiceConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "VoiceConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "capturedAt" TIMESTAMP(3),
    "capturedByUserId" TEXT,
    "jurisdiction" TEXT,
    "purpose" TEXT,
    "evidence" TEXT,
    "recordingConsent" "VoiceRecordingConsent" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT NOT NULL,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "campaignId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'TWILIO',
    "providerCallId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "eligibilityStatus" "CallEligibilityStatus" NOT NULL,
    "consentStatus" "VoiceConsentStatus" NOT NULL,
    "recordingConsentStatus" "VoiceRecordingConsent" NOT NULL,
    "aiDisclosureGiven" BOOLEAN NOT NULL DEFAULT false,
    "status" "CallStatus" NOT NULL DEFAULT 'CALL_REQUESTED',
    "outcome" "CallOutcome",
    "outcomeSetBy" "CallOutcomeSetBy",
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "recordingStatus" "VoiceRecordingConsent" NOT NULL DEFAULT 'UNKNOWN',
    "recordingProviderRef" TEXT,
    "transcriptStatus" "CallTranscriptStatus" NOT NULL DEFAULT 'TRANSCRIPT_NOT_AVAILABLE',
    "transcriptReplyId" TEXT,
    "cost" DOUBLE PRECISION,
    "currency" TEXT,
    "failedReason" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceConsent_contactId_key" ON "VoiceConsent"("contactId");

-- CreateIndex
CREATE INDEX "VoiceConsent_organizationId_idx" ON "VoiceConsent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_providerCallId_key" ON "Call"("providerCallId");

-- CreateIndex
CREATE INDEX "Call_organizationId_idx" ON "Call"("organizationId");

-- CreateIndex
CREATE INDEX "Call_contactId_idx" ON "Call"("contactId");

-- CreateIndex
CREATE INDEX "Call_companyId_idx" ON "Call"("companyId");

-- CreateIndex
CREATE INDEX "Call_campaignId_idx" ON "Call"("campaignId");

-- AddForeignKey
ALTER TABLE "VoiceConsent" ADD CONSTRAINT "VoiceConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceConsent" ADD CONSTRAINT "VoiceConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceConsent" ADD CONSTRAINT "VoiceConsent_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
