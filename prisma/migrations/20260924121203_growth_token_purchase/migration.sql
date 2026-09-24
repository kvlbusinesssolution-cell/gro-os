-- CreateEnum
CREATE TYPE "GrowthTokenPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "GrowthTokenPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "GrowthTokenPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "gatewayProvider" "PaymentGatewayProvider",
    "gatewayCheckoutSessionId" TEXT,
    "platformInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthTokenPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthTokenPurchase_platformInvoiceId_key" ON "GrowthTokenPurchase"("platformInvoiceId");

-- CreateIndex
CREATE INDEX "GrowthTokenPurchase_organizationId_status_idx" ON "GrowthTokenPurchase"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "GrowthTokenPurchase" ADD CONSTRAINT "GrowthTokenPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthTokenPurchase" ADD CONSTRAINT "GrowthTokenPurchase_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthTokenPurchase" ADD CONSTRAINT "GrowthTokenPurchase_platformInvoiceId_fkey" FOREIGN KEY ("platformInvoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
