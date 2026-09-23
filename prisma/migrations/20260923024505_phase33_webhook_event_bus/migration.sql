-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('CONTACT_CREATED', 'COMPANY_CREATED', 'DEAL_WON', 'DEAL_LOST', 'APPLICATION_STATUS_CHANGED');

-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "eventTypes" "WebhookEventType"[] DEFAULT ARRAY[]::"WebhookEventType"[];
