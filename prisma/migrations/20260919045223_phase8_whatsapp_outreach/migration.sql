-- CreateEnum
CREATE TYPE "WhatsAppConversationStatus" AS ENUM ('OPEN', 'CLOSED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "WhatsAppTemplateApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "DraftChannel" ADD VALUE 'WHATSAPP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DraftStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "DraftStatus" ADD VALUE 'READ';

-- AlterEnum
ALTER TYPE "EmailProviderEventType" ADD VALUE 'READ';

-- AlterEnum
ALTER TYPE "SendingIdentityProvider" ADD VALUE 'TWILIO_WHATSAPP';

-- DropIndex
DROP INDEX "SuppressionEntry_organizationId_email_key";

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "whatsappConversationId" TEXT,
ADD COLUMN     "whatsappTemplateId" TEXT;

-- AlterTable
ALTER TABLE "SuppressionEntry" ADD COLUMN     "channel" "DraftChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "phone" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT NOT NULL,
    "provider" "SendingIdentityProvider" NOT NULL DEFAULT 'TWILIO_WHATSAPP',
    "phoneNumber" TEXT NOT NULL,
    "status" "WhatsAppConversationStatus" NOT NULL DEFAULT 'OPEN',
    "providerConversationId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "assignedUserId" TEXT,
    "campaignId" TEXT,
    "opportunityId" TEXT,
    "restrictedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerTemplateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalStatus" "WhatsAppTemplateApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSendingIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "SendingIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyLimit" INTEGER NOT NULL DEFAULT 250,
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

    CONSTRAINT "WhatsAppSendingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppConversation_organizationId_status_idx" ON "WhatsAppConversation"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_organizationId_contactId_key" ON "WhatsAppConversation"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_organizationId_providerTemplateId_key" ON "WhatsAppTemplate"("organizationId", "providerTemplateId");

-- CreateIndex
CREATE INDEX "WhatsAppSendingIdentity_organizationId_idx" ON "WhatsAppSendingIdentity"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSendingIdentity_organizationId_phoneNumber_key" ON "WhatsAppSendingIdentity"("organizationId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDraft_providerMessageId_key" ON "EmailDraft"("providerMessageId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_phone_idx" ON "SuppressionEntry"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_organizationId_channel_email_key" ON "SuppressionEntry"("organizationId", "channel", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_organizationId_channel_phone_key" ON "SuppressionEntry"("organizationId", "channel", "phone");

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_whatsappConversationId_fkey" FOREIGN KEY ("whatsappConversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSendingIdentity" ADD CONSTRAINT "WhatsAppSendingIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

