-- CreateEnum
CREATE TYPE "SendingIdentityProvider" AS ENUM ('RESEND', 'SMTP', 'GMAIL', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "SendingIdentityStatus" AS ENUM ('ACTIVE', 'THROTTLED', 'COOLDOWN', 'PAUSED');

-- CreateEnum
CREATE TYPE "EmailProviderEventType" AS ENUM ('SENT', 'DELIVERED', 'BOUNCED', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'OPENED', 'CLICKED', 'REPLIED', 'UNSUBSCRIBED', 'COMPLAINT', 'FAILED', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'SPAM_COMPLAINT', 'HARD_BOUNCE', 'MANUAL_SUPPRESSION', 'LEGAL_REQUEST', 'OTHER');

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'EMAIL_DELIVERABILITY_RISK';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedReason" TEXT;

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "bounceType" TEXT;

-- CreateTable
CREATE TABLE "SendingIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "provider" "SendingIdentityProvider" NOT NULL,
    "status" "SendingIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyLimit" INTEGER NOT NULL DEFAULT 300,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 50,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentThisHour" INTEGER NOT NULL DEFAULT 0,
    "countersResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldownUntil" TIMESTAMP(3),
    "cooldownReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "lastSendAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailProviderEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailDraftId" TEXT,
    "sendingIdentityId" TEXT,
    "provider" "SendingIdentityProvider" NOT NULL,
    "eventType" "EmailProviderEventType" NOT NULL,
    "recipient" TEXT NOT NULL,
    "providerEventId" TEXT,
    "metadata" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SendingIdentity_organizationId_idx" ON "SendingIdentity"("organizationId");

-- CreateIndex
CREATE INDEX "SendingIdentity_status_idx" ON "SendingIdentity"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SendingIdentity_organizationId_email_key" ON "SendingIdentity"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailProviderEvent_providerEventId_key" ON "EmailProviderEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_organizationId_receivedAt_idx" ON "EmailProviderEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailProviderEvent_sendingIdentityId_idx" ON "EmailProviderEvent"("sendingIdentityId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_email_idx" ON "SuppressionEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_organizationId_email_key" ON "SuppressionEntry"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "EmailDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_sendingIdentityId_fkey" FOREIGN KEY ("sendingIdentityId") REFERENCES "SendingIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
