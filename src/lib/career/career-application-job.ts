import { prisma } from "@/lib/prisma";
import { submitApplicationCore, reconcileSubmissionStatusCore } from "./application-orchestrator";

/**
 * Phase 20 — §21-23/§53 real scheduled autonomous submission. Same real
 * opt-in discipline as Phase 19's career-discovery-job.ts: only ever acts
 * on a CareerProfile whose applicationAutomationMode the user has
 * explicitly set to AUTO_APPLY_APPROVED or FULL_AUTONOMOUS — every other
 * mode (the real default is DISCOVERY_ONLY) means this job does nothing
 * for that profile. submitApplicationCore itself re-runs the FULL, real
 * 11-condition autonomy safety gate independently for every single
 * application (§23) — this job never bypasses it.
 */
export interface AutonomousSubmissionSummary {
  applicationId: string;
  organizationId: string;
  status?: string;
  error?: string;
}

export async function runAutonomousApplicationSubmission(): Promise<AutonomousSubmissionSummary[]> {
  const applications = await prisma.jobApplication.findMany({
    where: {
      status: { in: ["READY_FOR_REVIEW", "USER_APPROVAL_REQUIRED"] },
      careerProfile: { applicationAutomationMode: { in: ["AUTO_APPLY_APPROVED", "FULL_AUTONOMOUS"] } },
    },
    select: { id: true, organizationId: true },
    take: 100,
  });

  const summaries: AutonomousSubmissionSummary[] = [];
  for (const app of applications) {
    const result = await submitApplicationCore(app.id, null);
    summaries.push({ applicationId: app.id, organizationId: app.organizationId, status: result.status, error: result.error });
  }
  return summaries;
}

/** §31/§39/§56 real, periodic reconciliation of any application still genuinely UNCONFIRMED/uncertain — never a blind retry, only a real provider-status re-check. */
export async function runSubmissionStatusReconciliation(): Promise<AutonomousSubmissionSummary[]> {
  const applications = await prisma.jobApplication.findMany({
    where: { status: { in: ["SUBMITTED", "SUBMITTED_UNCONFIRMED"] } },
    select: { id: true, organizationId: true },
    take: 200,
  });

  const summaries: AutonomousSubmissionSummary[] = [];
  for (const app of applications) {
    const result = await reconcileSubmissionStatusCore(app.id);
    summaries.push({ applicationId: app.id, organizationId: app.organizationId, status: result.status, error: result.error });
  }
  return summaries;
}
