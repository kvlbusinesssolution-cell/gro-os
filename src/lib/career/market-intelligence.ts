/**
 * Phase 22 (Career Learning + Job Market Intelligence) — §25-§34, §51-§53
 * real, evidence-based job market intelligence computed directly from the
 * real, global `Job` table (Phase 19). No fabricated market data anywhere —
 * every distribution below is a real count over real Job rows, and every
 * function that would otherwise need to guess (salary, industry) either
 * uses only source-provided values or explicitly labels its output
 * AI_INFERENCE (§33)/UNKNOWN (§30) rather than inventing a number.
 *
 * §26 — this codebase's only real job source today is Remotive (Phase 19 —
 * see job-providers/registry.ts), and Remotive's own real data does not
 * reliably state a country for most postings ("Worldwide"/multi-country
 * listings are common — see job-normalization.ts's own honest `country:
 * null` handling for exactly this case). `geography` below is therefore
 * "Global" by default — never a narrower, fabricated scope than the real
 * data supports.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export interface DistributionEntry {
  key: string;
  jobCount: number;
  percentage: number;
}

function toDistribution(counts: Map<string, number>, total: number): DistributionEntry[] {
  return [...counts.entries()]
    .map(([key, jobCount]) => ({ key, jobCount, percentage: total > 0 ? Math.round((jobCount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.jobCount - a.jobCount);
}

function bump(map: Map<string, number>, key: string | null | undefined): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

export interface SalaryObservation {
  role: string | null;
  currency: string;
  period: string;
  count: number;
  min: number;
  max: number;
  median: number;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface JobMarketSnapshotResult {
  sources: string[];
  geography: string;
  sampleSize: number;
  collectionPeriodStart: Date;
  collectionPeriodEnd: Date;
  skillDistribution: DistributionEntry[];
  technologyDistribution: DistributionEntry[];
  roleDistribution: DistributionEntry[];
  industryDistribution: DistributionEntry[];
  workModeDistribution: DistributionEntry[];
  locationDistribution: DistributionEntry[];
  experienceDistribution: DistributionEntry[];
  salaryObservations: SalaryObservation[];
  sourceQuality: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
}

/**
 * §53 source quality — a real, documented (not invented) criterion: a
 * single-provider, small sample is honestly LOW/UNKNOWN, never inflated.
 * Thresholds intentionally mirror the same conservative philosophy as
 * LEARNING_CONFIG (src/lib/learning/config.ts) without importing it
 * directly — that config's thresholds are tuned for outcome-rate
 * confidence, not raw catalog-size source quality, a genuinely different
 * question.
 */
function computeSourceQuality(providerCount: number, sampleSize: number): JobMarketSnapshotResult["sourceQuality"] {
  if (sampleSize === 0) return "UNKNOWN";
  if (providerCount >= 2 && sampleSize >= 200) return "HIGH";
  if (sampleSize >= 50) return "MEDIUM";
  return "LOW";
}

function experienceBand(minYears: number | null, maxYears: number | null): string | null {
  if (minYears === null && maxYears === null) return null;
  const anchor = minYears ?? maxYears!;
  if (anchor <= 2) return "0-2 years";
  if (anchor <= 5) return "3-5 years";
  if (anchor <= 8) return "5-8 years";
  return "8+ years";
}

/**
 * §25/§51 — computes a real snapshot from the CURRENT live Job table (never
 * fabricated). Does not persist — persistence is a separate, explicit step
 * (`persistJobMarketSnapshot`) so callers that only want a live read
 * (e.g. the dashboard) never trigger a write.
 */
export async function computeJobMarketSnapshot(): Promise<JobMarketSnapshotResult> {
  const jobs = await prisma.job.findMany({
    select: {
      technologies: true,
      requirements: true,
      title: true,
      industry: true,
      workMode: true,
      country: true,
      experienceMinYears: true,
      experienceMaxYears: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      careerLevel: true,
      sourceRecords: { select: { provider: true } },
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });

  const providers = new Set<string>();
  const skillCounts = new Map<string, number>();
  const techCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  const workModeCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const experienceCounts = new Map<string, number>();
  const salaryByRole = new Map<string, number[]>();
  let salaryCurrency: string | null = null;
  let salaryPeriod: string | null = null;
  const firstSeenDates: Date[] = [];
  const lastSeenDates: Date[] = [];

  for (const job of jobs) {
    for (const p of job.sourceRecords) providers.add(p.provider);
    // §27 — "skill" and "technology" are drawn from the same real source
    // field (Job.technologies); requirements.required/preferred (when the
    // source structured it) additionally populate skillDistribution, since
    // that's the field most directly answering "what does the market ask
    // for", while technologyDistribution stays the raw tag list.
    for (const tech of job.technologies) bump(techCounts, tech.toLowerCase());
    const requirements = job.requirements as { required?: string[]; preferred?: string[] } | null;
    for (const req of requirements?.required ?? []) bump(skillCounts, req.toLowerCase());
    for (const req of requirements?.preferred ?? []) bump(skillCounts, req.toLowerCase());
    if ((requirements?.required?.length ?? 0) === 0 && (requirements?.preferred?.length ?? 0) === 0) {
      for (const tech of job.technologies) bump(skillCounts, tech.toLowerCase());
    }

    // §29 — role titles are preserved verbatim, never over-normalized into
    // a family that could merge genuinely different roles.
    bump(roleCounts, job.title);
    // §33 — industry on Job is itself already an AI-assisted classification
    // upstream (job-normalization.ts docs this); honestly labeled here
    // rather than presented as a raw source fact.
    bump(industryCounts, job.industry ? `${job.industry} (AI_INFERENCE)` : null);
    bump(workModeCounts, job.workMode ?? "UNKNOWN");
    bump(locationCounts, job.country ?? "UNKNOWN");
    bump(experienceCounts, experienceBand(job.experienceMinYears, job.experienceMaxYears) ?? "UNKNOWN");

    if (job.salaryMin !== null && job.salaryMax !== null && job.salaryCurrency) {
      salaryCurrency = salaryCurrency ?? job.salaryCurrency;
      salaryPeriod = salaryPeriod ?? job.salaryPeriod ?? "UNKNOWN";
      const roleKey = job.careerLevel ?? "UNSPECIFIED";
      if (!salaryByRole.has(roleKey)) salaryByRole.set(roleKey, []);
      salaryByRole.get(roleKey)!.push((job.salaryMin + job.salaryMax) / 2);
    }
    firstSeenDates.push(job.firstSeenAt);
    lastSeenDates.push(job.lastSeenAt);
  }

  const total = jobs.length;

  // §30 — SOURCE-PROVIDED salary observations only; a role with fewer than
  // 3 real data points is never turned into a misleading min/max/median.
  const MIN_SALARY_SAMPLE = 3;
  const salaryObservations: SalaryObservation[] = [...salaryByRole.entries()]
    .filter(([, values]) => values.length >= MIN_SALARY_SAMPLE)
    .map(([role, values]) => ({
      role: role === "UNSPECIFIED" ? null : role,
      currency: salaryCurrency ?? "UNKNOWN",
      period: salaryPeriod ?? "UNKNOWN",
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      median: median(values),
    }));

  return {
    sources: [...providers],
    geography: "Global",
    sampleSize: total,
    collectionPeriodStart: firstSeenDates.length > 0 ? new Date(Math.min(...firstSeenDates.map((d) => d.getTime()))) : new Date(),
    collectionPeriodEnd: lastSeenDates.length > 0 ? new Date(Math.max(...lastSeenDates.map((d) => d.getTime()))) : new Date(),
    skillDistribution: toDistribution(skillCounts, total),
    technologyDistribution: toDistribution(techCounts, total),
    roleDistribution: toDistribution(roleCounts, total),
    industryDistribution: toDistribution(industryCounts, total),
    workModeDistribution: toDistribution(workModeCounts, total),
    locationDistribution: toDistribution(locationCounts, total),
    experienceDistribution: toDistribution(experienceCounts, total),
    salaryObservations,
    sourceQuality: computeSourceQuality(providers.size, total),
  };
}

/** §51 — persists the computed snapshot; called by the scheduled market-snapshot job, never silently on every dashboard read. */
export async function persistJobMarketSnapshot(): Promise<{ id: string; sampleSize: number }> {
  const snapshot = await computeJobMarketSnapshot();
  const row = await prisma.jobMarketSnapshot.create({
    data: {
      sources: snapshot.sources,
      geography: snapshot.geography,
      sampleSize: snapshot.sampleSize,
      collectionPeriodStart: snapshot.collectionPeriodStart,
      collectionPeriodEnd: snapshot.collectionPeriodEnd,
      skillDistribution: snapshot.skillDistribution as unknown as Prisma.InputJsonValue,
      technologyDistribution: snapshot.technologyDistribution as unknown as Prisma.InputJsonValue,
      roleDistribution: snapshot.roleDistribution as unknown as Prisma.InputJsonValue,
      industryDistribution: snapshot.industryDistribution as unknown as Prisma.InputJsonValue,
      workModeDistribution: snapshot.workModeDistribution as unknown as Prisma.InputJsonValue,
      locationDistribution: snapshot.locationDistribution as unknown as Prisma.InputJsonValue,
      experienceDistribution: snapshot.experienceDistribution as unknown as Prisma.InputJsonValue,
      salaryObservations: snapshot.salaryObservations as unknown as Prisma.InputJsonValue,
      sourceQuality: snapshot.sourceQuality,
    },
  });
  return { id: row.id, sampleSize: row.sampleSize };
}

export interface EmergingTechnology {
  technology: string;
  periodAJobCount: number;
  periodBJobCount: number;
  periodAPercentage: number;
  periodBPercentage: number;
  growthPercentagePoints: number;
}

const MIN_SAMPLE_FOR_EMERGING = 5;

/**
 * §28 — real period-over-period comparison between two persisted
 * snapshots (never a single-posting guess). A technology absent from
 * period A but present in period B needs at least MIN_SAMPLE_FOR_EMERGING
 * real mentions in period B before being called "emerging" — a single job
 * posting is explicitly not enough evidence (§28).
 */
export function detectEmergingTechnologies(
  periodA: { technologyDistribution: DistributionEntry[]; sampleSize: number },
  periodB: { technologyDistribution: DistributionEntry[]; sampleSize: number },
): EmergingTechnology[] {
  const aByKey = new Map(periodA.technologyDistribution.map((d) => [d.key, d]));
  const bByKey = new Map(periodB.technologyDistribution.map((d) => [d.key, d]));

  const results: EmergingTechnology[] = [];
  for (const [key, bEntry] of bByKey.entries()) {
    if (bEntry.jobCount < MIN_SAMPLE_FOR_EMERGING) continue;
    const aEntry = aByKey.get(key);
    const growth = bEntry.percentage - (aEntry?.percentage ?? 0);
    if (growth > 0) {
      results.push({
        technology: key,
        periodAJobCount: aEntry?.jobCount ?? 0,
        periodBJobCount: bEntry.jobCount,
        periodAPercentage: aEntry?.percentage ?? 0,
        periodBPercentage: bEntry.percentage,
        growthPercentagePoints: Math.round(growth * 10) / 10,
      });
    }
  }
  return results.sort((a, b) => b.growthPercentagePoints - a.growthPercentagePoints);
}
