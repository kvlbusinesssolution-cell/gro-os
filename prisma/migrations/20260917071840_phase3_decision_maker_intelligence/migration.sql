-- CreateEnum
CREATE TYPE "DecisionMakerRole" AS ENUM ('FOUNDER', 'CO_FOUNDER', 'CEO', 'DIRECTOR', 'CTO', 'COO', 'MARKETING_HEAD', 'SALES_HEAD', 'BUSINESS_DEVELOPMENT_HEAD', 'IT_HEAD', 'PRODUCT_HEAD');

-- CreateTable
CREATE TABLE "DecisionMaker" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "DecisionMakerRole" NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionMaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionMaker_companyId_idx" ON "DecisionMaker"("companyId");

-- AddForeignKey
ALTER TABLE "DecisionMaker" ADD CONSTRAINT "DecisionMaker_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionMaker" ADD CONSTRAINT "DecisionMaker_generatedByAgentId_fkey" FOREIGN KEY ("generatedByAgentId") REFERENCES "AIAgentInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
