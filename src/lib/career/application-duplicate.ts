/**
 * Phase 20 — §5/§51 real duplicate-application detection. Distinct from
 * Phase 19's job-deduplication.ts (which decides whether two SOURCE
 * POSTINGS are the same real job): by the time a Job row exists, that
 * identity question is already solved — this module only asks "has THIS
 * career profile already applied to THIS job".
 *
 * The primary signal is the real DB-level @@unique([careerProfileId, jobId])
 * constraint on JobApplication (the spec's own §51 requirement: "Database-
 * level uniqueness must be used where appropriate — application-level
 * duplicate checking alone is insufficient"). This function is the
 * pre-flight, human-readable check that runs BEFORE attempting the insert,
 * so a real, explained result can be shown instead of a raw constraint
 * violation.
 */

import { prisma } from "@/lib/prisma";

export type ApplicationDuplicateStatus = "NO_DUPLICATE" | "DUPLICATE_CONFIRMED" | "POSSIBLE_DUPLICATE" | "UNKNOWN";

export interface DuplicateCheckResult {
  status: ApplicationDuplicateStatus;
  existingApplicationId: string | null;
  detail: string;
}

export async function checkDuplicateApplication(careerProfileId: string, jobId: string): Promise<DuplicateCheckResult> {
  const exact = await prisma.jobApplication.findUnique({
    where: { careerProfileId_jobId: { careerProfileId, jobId } },
    select: { id: true, status: true },
  });
  if (exact) {
    return {
      status: "DUPLICATE_CONFIRMED",
      existingApplicationId: exact.id,
      detail: `An application for this exact job already exists (status: ${exact.status}).`,
    };
  }

  // §5 — "Do not create multiple applications for the same job merely
  // because the same job appeared from multiple sources." Job-level dedup
  // (Phase 19) already merges same-posting duplicates into one Job row
  // BEFORE a JobApplication can reference it, so a second real Job row for
  // the same real opening is itself a Phase-19 dedup miss, not something
  // this module can fix. The real, bounded secondary signal available
  // here: same company + normalized title, different jobId, already
  // applied — flagged for human review, never auto-merged or auto-blocked.
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { company: true, title: true } });
  if (!job) return { status: "UNKNOWN", existingApplicationId: null, detail: "Job record not found." };

  const possible = await prisma.jobApplication.findFirst({
    where: {
      careerProfileId,
      job: { company: { equals: job.company, mode: "insensitive" }, title: { equals: job.title, mode: "insensitive" } },
      jobId: { not: jobId },
    },
    select: { id: true, jobId: true },
  });
  if (possible) {
    return {
      status: "POSSIBLE_DUPLICATE",
      existingApplicationId: possible.id,
      detail: `An application already exists for the same company + title under a different Job record (${possible.jobId}) — possible undetected source duplicate.`,
    };
  }

  return { status: "NO_DUPLICATE", existingApplicationId: null, detail: "No existing application found for this job." };
}
