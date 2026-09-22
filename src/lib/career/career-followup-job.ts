import { prisma } from "@/lib/prisma";
import { scheduleFollowUpsForApplication, sendFollowUp } from "./application-followup";

/**
 * Phase 21 (§57) — two real, idempotent, retry-safe scheduled jobs:
 * scheduling new follow-up rows for newly-submitted applications, and
 * sending follow-ups whose time has come (re-checking stopping conditions
 * immediately before every send — see application-followup.ts). Plain
 * summary arrays here; the scheduler registry entry wraps these into
 * JobRunLog[] (same split as career-application-job.ts).
 */

export interface FollowUpScheduleSummary {
  applicationId: string;
  organizationId: string;
  created: number;
  error?: string;
}

export async function runFollowUpScheduling(): Promise<FollowUpScheduleSummary[]> {
  const applications = await prisma.jobApplication.findMany({
    where: { submittedAt: { not: null }, careerProfile: { followUpEnabled: true }, status: { notIn: ["WITHDRAWN", "CLOSED"] } },
    select: { id: true, organizationId: true },
  });

  const summaries: FollowUpScheduleSummary[] = [];
  for (const application of applications) {
    try {
      const result = await scheduleFollowUpsForApplication(application.id);
      summaries.push({ applicationId: application.id, organizationId: application.organizationId, created: result.created });
    } catch (error) {
      summaries.push({ applicationId: application.id, organizationId: application.organizationId, created: 0, error: error instanceof Error ? error.message : "Unknown error." });
    }
  }
  return summaries;
}

export interface FollowUpSendSummary {
  followUpId: string;
  organizationId: string;
  status: "SENT" | "CANCELLED" | "SKIPPED";
  reason?: string;
}

export async function runFollowUpSending(): Promise<FollowUpSendSummary[]> {
  const due = await prisma.careerFollowUp.findMany({ where: { status: "PENDING", scheduledFor: { lte: new Date() } }, select: { id: true, organizationId: true } });

  const summaries: FollowUpSendSummary[] = [];
  for (const followUp of due) {
    try {
      const result = await sendFollowUp(followUp.id);
      summaries.push({ followUpId: followUp.id, organizationId: followUp.organizationId, status: result.status, reason: result.reason });
    } catch (error) {
      summaries.push({ followUpId: followUp.id, organizationId: followUp.organizationId, status: "SKIPPED", reason: error instanceof Error ? error.message : "Unknown error." });
    }
  }
  return summaries;
}
