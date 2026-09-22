/**
 * Phase 22 (Career Learning + Job Market Intelligence) — §65-§72 the 8 real
 * AI Career Questions. Every function here reads real, already-computed,
 * already-stored data (JobMatch.dimensions/explanation from Phase 19,
 * CareerFollowUp/CareerInterview/RecruiterCommunication from Phase 21) —
 * nothing here re-invents matching/eligibility/scheduling logic, and
 * nothing auto-applies/auto-schedules/auto-sends anything (§19, §66: Phase
 * 20's automation policy still controls application submission; Phase 21's
 * autonomousSchedulingEnabled still controls scheduling).
 *
 * §47 — every result is explicitly ACTUAL (directly recorded), OBSERVATION
 * (a pattern found in actual data), PREDICTION (forward-looking, always
 * hedged), or RECOMMENDATION (a suggested action) — never collapsed.
 */

import { prisma } from "@/lib/prisma";
import { evaluateFollowUpStoppingConditions } from "./application-followup";
import { getResumePerformance, getSkillOutcomeAssociation } from "./outcome-analytics";
import { getSkillGapAnalysis } from "./skill-gap-analysis";

// ===== §19/§20/§66 — WHAT SHOULD I APPLY TO TODAY? / WHY? =====

export interface ApplyTodayItem {
  jobId: string;
  jobMatchId: string;
  title: string;
  company: string;
  actualMatch: {
    kind: "ACTUAL";
    overallScore: number;
    eligibility: string;
    dimensions: unknown;
  };
  why: { kind: "OBSERVATION"; whyMatched: string[]; whatIsMissing: string[]; whatIsRisky: string[] } | null;
  recommendation: { kind: "RECOMMENDATION"; action: string };
}

export async function whatShouldIApplyToday(organizationId: string, careerProfileId: string, limit = 10): Promise<ApplyTodayItem[]> {
  const matches = await prisma.jobMatch.findMany({
    where: {
      organizationId,
      careerProfileId,
      status: { in: ["MATCHED", "SHORTLISTED"] },
      application: null, // §19 — duplicate check: never suggest a job already applied to.
    },
    orderBy: { overallScore: "desc" },
    take: limit,
    include: { job: { select: { id: true, title: true, company: true } } },
  });

  return matches.map((m) => {
    const explanation = m.explanation as { whyMatched?: string[]; whatIsMissing?: string[]; whatIsRisky?: string[] } | null;
    return {
      jobId: m.job.id,
      jobMatchId: m.id,
      title: m.job.title,
      company: m.job.company,
      actualMatch: { kind: "ACTUAL", overallScore: m.overallScore, eligibility: m.eligibility, dimensions: m.dimensions },
      why: explanation ? { kind: "OBSERVATION", whyMatched: explanation.whyMatched ?? [], whatIsMissing: explanation.whatIsMissing ?? [], whatIsRisky: explanation.whatIsRisky ?? [] } : null,
      // §19 — never auto-applies; Phase 20's automationMode still gates real submission.
      recommendation: { kind: "RECOMMENDATION", action: "Consider reviewing and applying — submission still requires your own automation-mode policy to allow it." },
    };
  });
}

// ===== §21/§67 — WHAT NEEDS FOLLOW-UP? =====

export interface FollowUpNeeded {
  applicationId: string;
  jobTitle: string;
  company: string;
  dayOffset: number;
  scheduledFor: Date;
  daysElapsedSinceSubmission: number | null;
}

export async function whatNeedsFollowUp(organizationId: string, careerProfileId: string): Promise<FollowUpNeeded[]> {
  const pending = await prisma.careerFollowUp.findMany({
    where: { organizationId, careerProfileId, status: "PENDING", scheduledFor: { lte: new Date() } },
    include: { application: { select: { id: true, submittedAt: true, job: { select: { title: true, company: true } } } } },
    orderBy: { scheduledFor: "asc" },
  });

  const results: FollowUpNeeded[] = [];
  for (const f of pending) {
    // §21/§58 — re-check real stopping conditions right now, never rely on
    // the state from when the follow-up was originally scheduled.
    const stop = await evaluateFollowUpStoppingConditions(f.applicationId);
    if (!stop.shouldSend) continue;
    results.push({
      applicationId: f.applicationId,
      jobTitle: f.application.job.title,
      company: f.application.job.company,
      dayOffset: f.dayOffset,
      scheduledFor: f.scheduledFor,
      daysElapsedSinceSubmission: f.application.submittedAt ? Math.floor((Date.now() - f.application.submittedAt.getTime()) / 86_400_000) : null,
    });
  }
  return results;
}

// ===== §22/§68 — WHO REPLIED? =====

export interface WhoReplied {
  applicationId: string | null;
  company: string;
  role: string;
  recruiterEmail: string | null;
  date: Date;
  classification: string;
  nextAction: string;
}

export async function whoReplied(organizationId: string, careerProfileId: string, since?: Date): Promise<WhoReplied[]> {
  const comms = await prisma.recruiterCommunication.findMany({
    where: {
      organizationId,
      application: { careerProfileId },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    include: { application: { select: { id: true, job: { select: { title: true, company: true } } } }, reply: { select: { contact: { select: { email: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return comms.map((c) => ({
    applicationId: c.applicationId,
    company: c.application?.job.company ?? "Unknown (unmatched communication)",
    role: c.application?.job.title ?? "Unknown",
    recruiterEmail: c.reply.contact.email ?? null,
    date: c.createdAt,
    classification: c.manualClassification ?? c.classification,
    nextAction: c.nextAction,
  }));
}

// ===== §23/§69 — WHAT INTERVIEWS ARE UPCOMING? =====

export interface UpcomingInterview {
  company: string;
  role: string;
  status: string;
  scheduledAtUtc: Date | null;
  localDate: string | null;
  localTime: string | null;
  timezone: string | null;
  meetingLink: string | null;
  stage: string | null;
  preparationAvailable: boolean;
}

export async function whatInterviewsAreUpcoming(organizationId: string, careerProfileId: string): Promise<UpcomingInterview[]> {
  const interviews = await prisma.careerInterview.findMany({
    where: {
      organizationId,
      careerProfileId,
      status: { in: ["REQUESTED", "PENDING_APPROVAL", "SCHEDULED", "RESCHEDULE_REQUESTED", "RESCHEDULED"] },
    },
    include: { application: { select: { job: { select: { title: true, company: true } } } } },
    orderBy: { scheduledAtUtc: "asc" },
  });

  return interviews.map((i) => ({
    company: i.application.job.company,
    role: i.application.job.title,
    status: i.status,
    scheduledAtUtc: i.scheduledAtUtc,
    localDate: i.localDate,
    localTime: i.localTime,
    timezone: i.timezone,
    meetingLink: i.meetingLink,
    stage: i.stage,
    preparationAvailable: i.preparationNotes !== null,
  }));
}

// ===== §70 — WHAT SKILLS ARE IN DEMAND? =====

export interface SkillDemandAnswer {
  kind: "OBSERVATION" | "INSUFFICIENT_DATA";
  skills: { skill: string; jobCount: number; percentage: number }[];
  collectionPeriodStart: Date | null;
  collectionPeriodEnd: Date | null;
  geography: string | null;
  sources: string[];
  sampleSize: number;
}

export async function whatSkillsAreInDemand(limit = 20): Promise<SkillDemandAnswer> {
  const latest = await prisma.jobMarketSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
  if (!latest || latest.sampleSize === 0) {
    return { kind: "INSUFFICIENT_DATA", skills: [], collectionPeriodStart: null, collectionPeriodEnd: null, geography: null, sources: [], sampleSize: 0 };
  }
  const skills = (latest.skillDistribution as { key: string; jobCount: number; percentage: number }[]).slice(0, limit);
  return {
    kind: "OBSERVATION",
    skills: skills.map((s) => ({ skill: s.key, jobCount: s.jobCount, percentage: s.percentage })),
    collectionPeriodStart: latest.collectionPeriodStart,
    collectionPeriodEnd: latest.collectionPeriodEnd,
    geography: latest.geography,
    sources: latest.sources,
    sampleSize: latest.sampleSize,
  };
}

// ===== §71 — WHAT SKILLS AM I MISSING? =====

export async function whatSkillsAmIMissing(organizationId: string, careerProfileId: string) {
  const result = await getSkillGapAnalysis(organizationId, careerProfileId);
  return { ...result, gaps: result.gaps.filter((g) => g.userEvidenceStatus !== "PRESENT") };
}

// ===== §72 — WHICH CV PERFORMS BETTER? (OBSERVATION only, never an unsupported winner) =====

export async function whichCvPerformsBetter(organizationId: string, careerProfileId: string) {
  return getResumePerformance(organizationId, careerProfileId);
}

// ===== Re-exported for a single import surface (career-agent.ts / dashboard actions) =====
export { getSkillOutcomeAssociation };
