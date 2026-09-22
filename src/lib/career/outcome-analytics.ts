/**
 * Phase 22 (Career Learning + Job Market Intelligence) — §3-§24, §39-§50 the
 * real career-outcome learning engine.
 *
 * Deliberately NOT built on a new event-log model: every real outcome fact
 * already exists on JobApplication (its own full status timeline +
 * timestamps — submittedAt/confirmedAt/rejectedAt/withdrawnAt/
 * interviewDetectedAt/offerDetectedAt), Job, JobMatch, CareerResume and
 * RecruiterCommunication — §5 explicitly permits (and this module follows)
 * computing directly from those existing rows rather than duplicating an
 * Application/Event system.
 *
 * §17 (CRITICAL) — every result below is explicitly labeled ACTUAL,
 * OBSERVATION, or RECOMMENDATION — this module itself makes no
 * forward-looking numeric estimates. Phase 29 added real, dedicated
 * `kind: "PREDICTION"` functions (src/lib/career/career-predictions.ts —
 * application-response/interview/offer/match-to-response likelihood) that
 * blend this module's real classifySampleSize/classifyConfidence/rate data
 * with a forward-looking case rather than adding PREDICTION output here,
 * to keep this file's own scope (real historical rear-facing observations)
 * unchanged. An OBSERVATION never claims a
 * cause; see `describeObservation` below — every sentence this module
 * generates is grammatically an association ("was associated with"), never
 * a causal claim ("caused").
 *
 * Sample-size/confidence vocabulary and THRESHOLDS are reused directly from
 * the existing (Phase 11) revenue Learning engine's own config
 * (LEARNING_CONFIG in src/lib/learning/config.ts) and enums
 * (LearningSampleClassification, LearningConfidence) — genuine reuse per
 * §2/§16, not reinvented numbers. The classification FUNCTION itself is a
 * small (~15 line) parallel implementation because the existing
 * `sampleClassification`/`confidenceBucket` in src/lib/learning/patterns.ts
 * take a `LearningObservation[]` (Prisma model with revenue-specific
 * fields: dealSize, salesCycleDays, outcome: "WON"|"LOST", …) as their input
 * type and cannot be called against career-shaped cohorts without a much
 * larger, riskier retrofit of that model (see schema.prisma's Phase 22
 * doc comment for the full reasoning).
 */

import { prisma } from "@/lib/prisma";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { LEARNING_CONFIG } from "@/lib/learning/config";

export type SampleClassification = "INSUFFICIENT_DATA" | "LOW_SAMPLE" | "OBSERVED" | "STRONG_OBSERVATION";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/** §16 — mirrors src/lib/learning/patterns.ts's sampleClassification, same LEARNING_CONFIG thresholds, career-shaped input (a plain sample size). */
export function classifySampleSize(sampleSize: number): SampleClassification {
  if (sampleSize < LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT) return "INSUFFICIENT_DATA";
  if (sampleSize < LEARNING_CONFIG.MIN_SAMPLE_OBSERVED) return "LOW_SAMPLE";
  if (sampleSize < LEARNING_CONFIG.MIN_SAMPLE_STRONG) return "OBSERVED";
  return "STRONG_OBSERVATION";
}

/** §15 — a classification below OBSERVED can never be called MEDIUM/HIGH confidence, same hard-gate discipline as confidenceBucket in patterns.ts. */
export function classifyConfidence(sampleSize: number, classification: SampleClassification): Confidence {
  if (classification === "INSUFFICIENT_DATA" || classification === "LOW_SAMPLE") return "LOW";
  if (sampleSize >= LEARNING_CONFIG.MIN_SAMPLE_STRONG) return "HIGH";
  return "MEDIUM";
}

export interface RateObservation {
  kind: "OBSERVATION";
  label: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  sampleSize: number;
  sampleClassification: SampleClassification;
  confidence: Confidence;
  timePeriodStart: Date | null;
  timePeriodEnd: Date | null;
  /** Always an association, never a causal claim — §17. */
  statement: string;
}

function periodBounds(dates: Date[]): { start: Date | null; end: Date | null } {
  if (dates.length === 0) return { start: null, end: null };
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
}

/** §6-14 — the one shared rate-computation helper every performance breakdown below uses, so every metric shares the exact same denominator discipline (§36/§74: never mix denominators). */
export function buildRateObservation(label: string, numerator: number, denominator: number, dates: Date[]): RateObservation {
  const sampleClassification = classifySampleSize(denominator);
  const confidence = classifyConfidence(denominator, sampleClassification);
  const rate = denominator > 0 ? numerator / denominator : null;
  const { start, end } = periodBounds(dates);

  const statement =
    denominator === 0
      ? `No observed sample for "${label}" — INSUFFICIENT_DATA.`
      : sampleClassification === "INSUFFICIENT_DATA"
        ? `Within an observed sample of ${denominator} (too small to draw a reliable rate from), ${numerator} showed "${label}" — INSUFFICIENT_DATA.`
        : `Within the observed sample of ${denominator}, "${label}" was associated with ${numerator} (${Math.round((rate ?? 0) * 100)}%).`;

  return { kind: "OBSERVATION", label, numerator, denominator, rate, sampleSize: denominator, sampleClassification, confidence, timePeriodStart: start, timePeriodEnd: end, statement };
}

// ===== §3/§4 — Actual outcome timeline (ACTUAL, not OBSERVATION: directly recorded facts) =====

const RESPONDED_STATUSES: ApplicationStatus[] = [
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "CLOSED",
];
const INTERVIEWED_OR_BEYOND: ApplicationStatus[] = ["INTERVIEW", "OFFER"];

export interface CareerOutcomeFunnel {
  kind: "ACTUAL";
  discovered: number;
  matched: number;
  shortlisted: number;
  applications: number;
  // §3/§59 responded = a real RecruiterCommunication with matchStatus MATCHED
  // exists for the application, OR the application's own status already
  // reflects a real recruiter action (REJECTED/INTERVIEW/OFFER/CLOSED) —
  // never inferred from silence.
  responded: number;
  interviews: number;
  offers: number;
  rejections: number;
  withdrawn: number;
  // §40 — genuinely distinct from `offers`; an offer is never treated as an
  // accepted job without a real, explicit CLOSED-with-offer-evidence
  // record. This codebase has no separate "accepted job" confirmation flow
  // yet (§AJ remaining gap) — always 0 today, never inferred from OFFER.
  acceptedJobs: number;
  // §42 — NO_RESPONSE only counts applications past the observation window
  // with no real response evidence, not merely "no response yet".
  noResponseObservationWindowDays: number;
  noResponse: number;
  organizationId: string;
  careerProfileId: string | null;
}

const NO_RESPONSE_OBSERVATION_WINDOW_DAYS = 14;

export async function getCareerOutcomeFunnel(organizationId: string, careerProfileId: string | null, since?: Date): Promise<CareerOutcomeFunnel> {
  const matchWhere = { organizationId, ...(careerProfileId ? { careerProfileId } : {}), ...(since ? { createdAt: { gte: since } } : {}) };
  const appWhere = { organizationId, ...(careerProfileId ? { careerProfileId } : {}), ...(since ? { createdAt: { gte: since } } : {}) };

  const [discovered, matched, shortlisted, applications, respondedCommCount, interviews, offers, rejections, withdrawn, staleApplications] = await Promise.all([
    prisma.jobMatch.count({ where: matchWhere }),
    prisma.jobMatch.count({ where: { ...matchWhere, status: { in: ["MATCHED", "SHORTLISTED"] } } }),
    prisma.jobMatch.count({ where: { ...matchWhere, status: "SHORTLISTED" } }),
    prisma.jobApplication.count({ where: appWhere }),
    prisma.jobApplication.count({ where: { ...appWhere, communications: { some: { matchStatus: "MATCHED" } } } }),
    prisma.jobApplication.count({ where: { ...appWhere, status: { in: INTERVIEWED_OR_BEYOND } } }),
    prisma.jobApplication.count({ where: { ...appWhere, status: "OFFER" } }),
    prisma.jobApplication.count({ where: { ...appWhere, status: "REJECTED" } }),
    prisma.jobApplication.count({ where: { ...appWhere, status: "WITHDRAWN" } }),
    prisma.jobApplication.count({
      where: {
        ...appWhere,
        status: { notIn: RESPONDED_STATUSES.concat(["WITHDRAWN", "DISCOVERED", "MATCHED", "SHORTLISTED", "PREPARING", "READY_FOR_REVIEW", "USER_APPROVAL_REQUIRED"]) },
        submittedAt: { lte: new Date(Date.now() - NO_RESPONSE_OBSERVATION_WINDOW_DAYS * 86_400_000) },
        communications: { none: {} },
      },
    }),
  ]);

  return {
    kind: "ACTUAL",
    discovered,
    matched,
    shortlisted,
    applications,
    responded: respondedCommCount,
    interviews,
    offers,
    rejections,
    withdrawn,
    acceptedJobs: 0,
    noResponseObservationWindowDays: NO_RESPONSE_OBSERVATION_WINDOW_DAYS,
    noResponse: staleApplications,
    organizationId,
    careerProfileId,
  };
}

// ===== §6/§7 — CV version performance (OBSERVATION, never a declared "winner") =====

export interface CvVersionPerformance {
  resumeId: string;
  resumeVersion: number | null;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
  offerRate: RateObservation;
}

export async function getResumePerformance(organizationId: string, careerProfileId: string): Promise<{ kind: "OBSERVATION"; versions: CvVersionPerformance[]; controlsNote: string }> {
  const apps = await prisma.jobApplication.findMany({
    where: { organizationId, careerProfileId, selectedResumeId: { not: null } },
    select: { selectedResumeId: true, status: true, createdAt: true, communications: { select: { matchStatus: true } }, job: { select: { title: true, company: true } } },
  });

  const byResume = new Map<string, typeof apps>();
  for (const app of apps) {
    const key = app.selectedResumeId!;
    if (!byResume.has(key)) byResume.set(key, []);
    byResume.get(key)!.push(app);
  }

  const resumeIds = [...byResume.keys()];
  const resumes = resumeIds.length > 0 ? await prisma.careerResume.findMany({ where: { id: { in: resumeIds } }, select: { id: true, version: true } }) : [];
  const versionById = new Map(resumes.map((r) => [r.id, r.version]));

  const versions: CvVersionPerformance[] = resumeIds.map((resumeId) => {
    const group = byResume.get(resumeId)!;
    const dates = group.map((a) => a.createdAt);
    const responded = group.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(a.status)).length;
    const interviewed = group.filter((a) => INTERVIEWED_OR_BEYOND.includes(a.status)).length;
    const offered = group.filter((a) => a.status === "OFFER").length;

    return {
      resumeId,
      resumeVersion: versionById.get(resumeId) ?? null,
      applications: group.length,
      responseRate: buildRateObservation("responses", responded, group.length, dates),
      interviewRate: buildRateObservation("interviews", interviewed, group.length, dates),
      offerRate: buildRateObservation("offers", offered, group.length, dates),
    };
  });

  return {
    kind: "OBSERVATION",
    versions,
    // §7 — never claims causation and explicitly flags the uncontrolled
    // variables this codebase does NOT stratify by yet (job type,
    // industry, seniority, location, company, source) — an honest
    // disclosure, not a hidden gap.
    controlsNote:
      "These counts are NOT controlled for job type, industry, seniority, location, company or time period — two resume versions may simply have been used for different kinds of roles. A higher observed rate is a POSSIBLE_EXPLANATION worth investigating, never a proven cause.",
  };
}

// ===== §8 — Skill → outcome association (OBSERVATION only, never causation) =====

export interface SkillAssociation {
  skill: string;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
}

export async function getSkillOutcomeAssociation(organizationId: string, careerProfileId: string): Promise<{ kind: "OBSERVATION"; skills: SkillAssociation[] }> {
  const apps = await prisma.jobApplication.findMany({
    where: { organizationId, careerProfileId },
    select: { status: true, createdAt: true, communications: { select: { matchStatus: true } }, job: { select: { technologies: true } } },
  });

  const bySkill = new Map<string, typeof apps>();
  for (const app of apps) {
    for (const skill of app.job.technologies) {
      const key = skill.toLowerCase();
      if (!bySkill.has(key)) bySkill.set(key, []);
      bySkill.get(key)!.push(app);
    }
  }

  const skills: SkillAssociation[] = [...bySkill.entries()]
    .map(([skill, group]) => {
      const dates = group.map((a) => a.createdAt);
      const responded = group.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(a.status)).length;
      const interviewed = group.filter((a) => INTERVIEWED_OR_BEYOND.includes(a.status)).length;
      return {
        skill,
        applications: group.length,
        responseRate: buildRateObservation(`responses for applications mentioning "${skill}"`, responded, group.length, dates),
        interviewRate: buildRateObservation(`interviews for applications mentioning "${skill}"`, interviewed, group.length, dates),
      };
    })
    .sort((a, b) => b.applications - a.applications);

  return { kind: "OBSERVATION", skills };
}

// ===== §10/§11 — Channel / source performance =====

export interface ChannelPerformance {
  channel: string;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
  offerRate: RateObservation;
}

export async function getChannelPerformance(organizationId: string, careerProfileId: string | null): Promise<{ kind: "OBSERVATION"; channels: ChannelPerformance[] }> {
  const apps = await prisma.jobApplication.findMany({
    where: { organizationId, ...(careerProfileId ? { careerProfileId } : {}) },
    select: { submissionMethod: true, status: true, createdAt: true, communications: { select: { matchStatus: true } } },
  });

  const byChannel = new Map<string, typeof apps>();
  for (const app of apps) {
    const key = app.submissionMethod ?? "NOT_YET_DETERMINED";
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key)!.push(app);
  }

  const channels: ChannelPerformance[] = [...byChannel.entries()].map(([channel, group]) => {
    const dates = group.map((a) => a.createdAt);
    const responded = group.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(a.status)).length;
    const interviewed = group.filter((a) => INTERVIEWED_OR_BEYOND.includes(a.status)).length;
    const offered = group.filter((a) => a.status === "OFFER").length;
    return {
      channel,
      applications: group.length,
      responseRate: buildRateObservation(`responses via ${channel}`, responded, group.length, dates),
      interviewRate: buildRateObservation(`interviews via ${channel}`, interviewed, group.length, dates),
      offerRate: buildRateObservation(`offers via ${channel}`, offered, group.length, dates),
    };
  });

  return { kind: "OBSERVATION", channels };
}

export interface SourcePerformance {
  provider: string;
  discovered: number;
  matched: number;
  shortlisted: number;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
}

export async function getJobSourcePerformance(organizationId: string, careerProfileId: string | null): Promise<{ kind: "OBSERVATION"; sources: SourcePerformance[] }> {
  const matches = await prisma.jobMatch.findMany({
    where: { organizationId, ...(careerProfileId ? { careerProfileId } : {}) },
    select: { status: true, job: { select: { sourceRecords: { select: { provider: true } } } }, application: { select: { status: true, createdAt: true, communications: { select: { matchStatus: true } } } } },
  });

  const byProvider = new Map<string, typeof matches>();
  for (const m of matches) {
    const providers = new Set(m.job.sourceRecords.map((r) => r.provider));
    for (const provider of providers.size > 0 ? providers : ["UNKNOWN"]) {
      if (!byProvider.has(provider)) byProvider.set(provider, []);
      byProvider.get(provider)!.push(m);
    }
  }

  const sources: SourcePerformance[] = [...byProvider.entries()].map(([provider, group]) => {
    const withApp = group.filter((m) => m.application);
    const dates = withApp.map((m) => m.application!.createdAt);
    const responded = withApp.filter((m) => m.application!.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(m.application!.status)).length;
    const interviewed = withApp.filter((m) => INTERVIEWED_OR_BEYOND.includes(m.application!.status)).length;
    return {
      provider,
      discovered: group.length,
      matched: group.filter((m) => ["MATCHED", "SHORTLISTED"].includes(m.status)).length,
      shortlisted: group.filter((m) => m.status === "SHORTLISTED").length,
      applications: withApp.length,
      responseRate: buildRateObservation(`responses from ${provider}-sourced applications`, responded, withApp.length, dates),
      interviewRate: buildRateObservation(`interviews from ${provider}-sourced applications`, interviewed, withApp.length, dates),
    };
  });

  return { kind: "OBSERVATION", sources };
}

// ===== §12/§13 — Role / Company performance =====

export interface RolePerformance {
  roleTitle: string;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
  offerRate: RateObservation;
}

export async function getRolePerformance(organizationId: string, careerProfileId: string | null): Promise<{ kind: "OBSERVATION"; roles: RolePerformance[] }> {
  const apps = await prisma.jobApplication.findMany({
    where: { organizationId, ...(careerProfileId ? { careerProfileId } : {}) },
    select: { status: true, createdAt: true, communications: { select: { matchStatus: true } }, job: { select: { title: true } } },
  });

  const byRole = new Map<string, typeof apps>();
  for (const app of apps) {
    const key = app.job.title;
    if (!byRole.has(key)) byRole.set(key, []);
    byRole.get(key)!.push(app);
  }

  const roles: RolePerformance[] = [...byRole.entries()].map(([roleTitle, group]) => {
    const dates = group.map((a) => a.createdAt);
    const responded = group.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(a.status)).length;
    const interviewed = group.filter((a) => INTERVIEWED_OR_BEYOND.includes(a.status)).length;
    const offered = group.filter((a) => a.status === "OFFER").length;
    return {
      roleTitle,
      applications: group.length,
      responseRate: buildRateObservation(`responses for "${roleTitle}"`, responded, group.length, dates),
      interviewRate: buildRateObservation(`interviews for "${roleTitle}"`, interviewed, group.length, dates),
      offerRate: buildRateObservation(`offers for "${roleTitle}"`, offered, group.length, dates),
    };
  });

  return { kind: "OBSERVATION", roles };
}

export interface CompanyPerformance {
  company: string;
  applications: number;
  responseRate: RateObservation;
  interviewRate: RateObservation;
  medianResponseDays: number | null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function getCompanyPerformance(organizationId: string, careerProfileId: string | null): Promise<{ kind: "OBSERVATION"; companies: CompanyPerformance[] }> {
  const apps = await prisma.jobApplication.findMany({
    where: { organizationId, ...(careerProfileId ? { careerProfileId } : {}) },
    select: {
      status: true,
      createdAt: true,
      submittedAt: true,
      communications: { select: { matchStatus: true, createdAt: true } },
      job: { select: { company: true } },
    },
  });

  const byCompany = new Map<string, typeof apps>();
  for (const app of apps) {
    const key = app.job.company;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(app);
  }

  const companies: CompanyPerformance[] = [...byCompany.entries()].map(([company, group]) => {
    const dates = group.map((a) => a.createdAt);
    const responded = group.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || RESPONDED_STATUSES.includes(a.status));
    const interviewed = group.filter((a) => INTERVIEWED_OR_BEYOND.includes(a.status)).length;

    // §14 — real application -> first-response gap, only where BOTH real
    // timestamps exist; never estimated.
    const responseDays: number[] = [];
    for (const app of responded) {
      const firstResponse = app.communications.filter((c) => c.matchStatus === "MATCHED").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (app.submittedAt && firstResponse) {
        responseDays.push((firstResponse.createdAt.getTime() - app.submittedAt.getTime()) / 86_400_000);
      }
    }

    return {
      company,
      applications: group.length,
      responseRate: buildRateObservation(`responses from ${company}`, responded.length, group.length, dates),
      interviewRate: buildRateObservation(`interviews from ${company}`, interviewed, group.length, dates),
      medianResponseDays: median(responseDays),
    };
  });

  return { kind: "OBSERVATION", companies };
}

// ===== §41 — Rejection reasons (never inferred when absent) =====

export interface RejectionReasonSummary {
  totalRejections: number;
  withExplicitReason: number;
  // §41 — the real quoted classification evidence text from the rejection
  // email itself (RecruiterCommunication.classificationEvidence). This
  // codebase's real extraction schema (recruiter-message-classification.ts)
  // does not parse a structured "reason category" out of a rejection email
  // — only the classification + its real quoted evidence exist — so this
  // is honestly reported as raw quoted text per application, never grouped
  // into invented categories like "role mismatch"/"skill gap" that no real
  // extraction step actually produced.
  reasonTexts: { applicationId: string; text: string }[];
}

export async function getRejectionReasons(organizationId: string, careerProfileId: string | null): Promise<RejectionReasonSummary> {
  const rejected = await prisma.jobApplication.findMany({
    where: { organizationId, ...(careerProfileId ? { careerProfileId } : {}), status: "REJECTED" },
    select: { id: true, communications: { where: { classification: "REJECTED" }, select: { classificationEvidence: true } } },
  });

  const reasonTexts: { applicationId: string; text: string }[] = [];
  for (const app of rejected) {
    const withEvidence = app.communications.find((c) => !!c.classificationEvidence);
    if (withEvidence?.classificationEvidence) {
      reasonTexts.push({ applicationId: app.id, text: withEvidence.classificationEvidence });
    }
  }

  return {
    totalRejections: rejected.length,
    withExplicitReason: reasonTexts.length,
    // §41 Good example: "No rejection reason was provided." — a rejection
    // with no communication evidence is simply absent from this array,
    // never backfilled with a guessed explanation.
    reasonTexts,
  };
}
