-- CreateEnum
CREATE TYPE "ConversationIntent" AS ENUM ('INFORMATION_REQUEST', 'INTERESTED', 'EVALUATING', 'REQUEST_FOR_PROPOSAL', 'REQUEST_FOR_DEMO', 'NEGOTIATING', 'READY_TO_BUY', 'NOT_INTERESTED', 'FOLLOW_UP', 'SUPPORT', 'GENERAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConversationSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'MIXED', 'NEGATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConversationUrgency" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BudgetSignalType" AS ENUM ('EXPLICIT_BUDGET', 'BUDGET_RANGE', 'BUDGET_CONCERN', 'PRICE_SENSITIVITY', 'NO_BUDGET_MENTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DecisionMakerSignalType" AS ENUM ('KNOWN_DECISION_MAKER', 'POTENTIAL_DECISION_MAKER', 'NOT_IDENTIFIED');

-- CreateEnum
CREATE TYPE "ConversationAnalysisStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "inReplyToId" TEXT;

-- CreateTable
CREATE TABLE "ConversationIntelligence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "intent" "ConversationIntent" NOT NULL DEFAULT 'UNKNOWN',
    "sentiment" "ConversationSentiment" NOT NULL DEFAULT 'UNKNOWN',
    "urgency" "ConversationUrgency" NOT NULL DEFAULT 'UNKNOWN',
    "detectedBuyingStage" "BuyingStage",
    "detectedBuyingStageWhy" TEXT,
    "objections" JSONB NOT NULL DEFAULT '[]',
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "requestedServices" JSONB NOT NULL DEFAULT '[]',
    "competitorMentions" JSONB NOT NULL DEFAULT '[]',
    "budgetSignal" "BudgetSignalType" NOT NULL DEFAULT 'UNKNOWN',
    "budgetSignalDetail" TEXT,
    "timelineSignalRaw" TEXT,
    "timelineSignalNormalized" TEXT,
    "timelineSourceMessageId" TEXT,
    "decisionMakerSignal" "DecisionMakerSignalType" NOT NULL DEFAULT 'NOT_IDENTIFIED',
    "decisionMakerSignalWhy" TEXT,
    "nextAction" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" "ConversationAnalysisStatus" NOT NULL DEFAULT 'COMPLETED',
    "error" TEXT,
    "analyzedMessageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overriddenField" TEXT,
    "overriddenValue" TEXT,
    "overriddenByUserId" TEXT,
    "overrideReason" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationIntelligence_organizationId_idx" ON "ConversationIntelligence"("organizationId");

-- CreateIndex
CREATE INDEX "ConversationIntelligence_contactId_generatedAt_idx" ON "ConversationIntelligence"("contactId", "generatedAt");

-- CreateIndex
CREATE INDEX "ConversationIntelligence_companyId_idx" ON "ConversationIntelligence"("companyId");

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_inReplyToId_fkey" FOREIGN KEY ("inReplyToId") REFERENCES "Reply"("id") ON DELETE SET NULL ON UPDATE CASCADE;
