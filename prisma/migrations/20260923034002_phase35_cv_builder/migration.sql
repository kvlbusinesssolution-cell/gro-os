-- CreateEnum
CREATE TYPE "CareerCVTemplate" AS ENUM ('CLASSIC', 'MODERN', 'MINIMAL');

-- CreateTable
CREATE TABLE "CareerCV" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "templateKey" "CareerCVTemplate" NOT NULL DEFAULT 'CLASSIC',
    "content" JSONB NOT NULL,
    "storageKey" TEXT,
    "generatedAt" TIMESTAMP(3),
    "translatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerCV_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerCV_careerProfileId_idx" ON "CareerCV"("careerProfileId");

-- AddForeignKey
ALTER TABLE "CareerCV" ADD CONSTRAINT "CareerCV_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "CareerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerCV" ADD CONSTRAINT "CareerCV_translatedFromId_fkey" FOREIGN KEY ("translatedFromId") REFERENCES "CareerCV"("id") ON DELETE SET NULL ON UPDATE CASCADE;
