-- CreateEnum
CREATE TYPE "AgentDomain" AS ENUM ('BUSINESS', 'CAREER');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('REQUESTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'BLOCKED');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "domain" "AgentDomain" NOT NULL,
    "agentKey" TEXT NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "inputSummary" TEXT NOT NULL,
    "outputSummary" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "confidence" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_domain_createdAt_idx" ON "AgentRun"("organizationId", "domain", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_agentKey_idx" ON "AgentRun"("organizationId", "agentKey");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
