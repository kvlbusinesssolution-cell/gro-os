-- AlterTable
ALTER TABLE "OutreachMeeting" ADD COLUMN     "calendarEventId" TEXT,
ADD COLUMN     "calendarProvider" TEXT,
ADD COLUMN     "calendarSyncStatus" TEXT NOT NULL DEFAULT 'NOT_CONNECTED';
