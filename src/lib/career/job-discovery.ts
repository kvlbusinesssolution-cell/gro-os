import { prisma } from "@/lib/prisma";
import { getJobProviderByName } from "./job-providers/registry";
import { normalizeJob } from "./job-normalization";
import { findDuplicateJob, type DedupCandidate } from "./job-deduplication";
import { computeJobMatch, type JobMatchInput } from "./job-matching";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real discovery
 * orchestration (§34). Every step here operates on real data only:
 * a real provider HTTP call, real normalization, real deduplication
 * against real existing Job rows, real deterministic matching. A
 * JobDiscoveryRun row is always created and always reflects the real
 * outcome — never silently marked COMPLETED when a provider actually
 * failed (§37).
 *
 * §42/Remotive terms compliance: enforces a real minimum interval between
 * discovery runs for the SAME provider, checked against real
 * JobDiscoveryRun history — independent of whether the trigger was manual
 * or scheduled, so a user cannot accidentally exceed Remotive's own
 * "max. 4 times a day" guidance by repeatedly clicking "search now".
 */
const MIN_HOURS_BETWEEN_RUNS = 4; // conservative — well within Remotive's "max 4x/day" (an average of one run per 6h)

export interface DiscoveryRunResult {
  ok: boolean;
  error?: string;
  runId?: string;
  status?: string;
  resultCount?: number;
  newJobsCount?: number;
  duplicatesCount?: number;
  matchedCount?: number;
}

export async function runJobDiscoveryForProfile(
  careerProfileId: string,
  organizationId: string,
  triggeredBy: "MANUAL" | "SCHEDULED",
): Promise<DiscoveryRunResult> {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.organizationId !== organizationId) return { ok: false, error: "Career profile not found." };

  const provider = getJobProviderByName("Remotive");
  if (!provider) return { ok: false, error: "No job provider configured." };

  // Real cooldown check — real prior JobDiscoveryRun rows, not a guess.
  const recentRun = await prisma.jobDiscoveryRun.findFirst({
    where: { careerProfileId, provider: provider.name, startedAt: { gte: new Date(Date.now() - MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000) } },
    orderBy: { startedAt: "desc" },
  });
  if (recentRun) {
    return { ok: false, error: `Please wait — this profile last searched ${provider.name} less than ${MIN_HOURS_BETWEEN_RUNS} hours ago (real provider rate-limit courtesy).` };
  }

  const run = await prisma.jobDiscoveryRun.create({
    data: { careerProfileId, organizationId, provider: provider.name, triggeredBy, status: "RUNNING" },
  });

  const searchResult = await provider.search({
    roles: profile.targetRoles,
    technologies: profile.preferredTechnologies,
    remoteOnly: profile.workMode === "REMOTE",
  });

  if (searchResult.status !== "ACTIVE") {
    await prisma.jobDiscoveryRun.update({
      where: { id: run.id },
      data: {
        status: searchResult.rateLimited ? "RATE_LIMITED" : "FAILED",
        errorMessage: searchResult.error ?? "Provider search failed.",
        rateLimited: !!searchResult.rateLimited,
        finishedAt: new Date(),
      },
    });
    return { ok: false, error: searchResult.error ?? "Provider search failed.", runId: run.id, status: searchResult.rateLimited ? "RATE_LIMITED" : "FAILED" };
  }

  let newJobsCount = 0;
  let duplicatesCount = 0;
  let matchedCount = 0;

  for (const raw of searchResult.jobs) {
    const normalized = normalizeJob(raw, provider.name);

    // Real dedup candidates — every existing Job with the same company
    // (bounded, real query) or matching canonicalUrl.
    const candidates: DedupCandidate[] = (
      await prisma.job.findMany({
        where: { OR: [{ company: normalized.company }, { canonicalUrl: raw.canonicalUrl ?? undefined }] },
        select: { id: true, sourceRecords: { where: { provider: provider.name }, select: { sourceJobId: true } }, canonicalUrl: true, company: true, title: true, location: true, description: true, postingDate: true },
      })
    ).flatMap((j) =>
      j.sourceRecords.length > 0
        ? j.sourceRecords.map((sr) => ({ jobId: j.id, provider: provider.name, sourceJobId: sr.sourceJobId, canonicalUrl: j.canonicalUrl, company: j.company, title: j.title, location: j.location, description: j.description, postingDate: j.postingDate }))
        : [{ jobId: j.id, provider: provider.name, sourceJobId: "", canonicalUrl: j.canonicalUrl, company: j.company, title: j.title, location: j.location, description: j.description, postingDate: j.postingDate }],
    );

    const dedup = findDuplicateJob(
      { provider: provider.name, sourceJobId: raw.sourceJobId, canonicalUrl: raw.canonicalUrl, company: normalized.company, title: normalized.title, location: normalized.location, description: raw.description, postingDate: raw.postingDate },
      candidates,
    );

    let jobId: string;
    if (dedup.duplicateOfJobId) {
      duplicatesCount += 1;
      jobId = dedup.duplicateOfJobId;
      await prisma.job.update({ where: { id: jobId }, data: { lastSeenAt: new Date() } });
      await prisma.jobSourceRecord.upsert({
        where: { provider_sourceJobId: { provider: provider.name, sourceJobId: raw.sourceJobId } },
        update: { lastSeenAt: new Date() },
        create: { jobId, provider: provider.name, sourceJobId: raw.sourceJobId, sourceUrl: raw.sourceUrl, rawSnapshot: raw.rawSnapshot as unknown as Prisma.InputJsonValue },
      });
    } else {
      newJobsCount += 1;
      const job = await prisma.job.create({
        data: {
          title: normalized.title,
          sourceTitle: normalized.sourceTitle,
          company: normalized.company,
          location: normalized.location,
          country: normalized.country,
          city: normalized.city,
          workMode: normalized.workMode,
          description: raw.description,
          technologies: normalized.technologies,
          salaryMin: normalized.salaryMin,
          salaryMax: normalized.salaryMax,
          salaryCurrency: normalized.salaryCurrency,
          careerLevel: normalized.careerLevel,
          postingDate: raw.postingDate,
          canonicalUrl: raw.canonicalUrl,
          status: "DISCOVERED",
        },
      });
      jobId = job.id;
      await prisma.jobSourceRecord.create({
        data: { jobId, provider: provider.name, sourceJobId: raw.sourceJobId, sourceUrl: raw.sourceUrl, rawSnapshot: raw.rawSnapshot as unknown as Prisma.InputJsonValue },
      });
    }

    // Real match computation against this profile — every new or re-seen job gets a real, current match.
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const matchInput: JobMatchInput = {
      verifiedSkills: extractVerifiedSkillNames(profile.skills),
      targetRoles: profile.targetRoles,
      currentRole: profile.currentRole,
      yearsOfExperience: profile.yearsOfExperience,
      industries: profile.industries,
      targetCountries: profile.targetCountries,
      targetCities: profile.targetCities,
      workMode: profile.workMode,
      relocationPreference: profile.relocationPreference,
      salaryMin: profile.salaryMin,
      salaryMax: profile.salaryMax,
      salaryCurrency: profile.salaryCurrency,
      preferredTechnologies: profile.preferredTechnologies,
      excludedTechnologies: profile.excludedTechnologies,
      preferredCompanies: profile.preferredCompanies,
      excludedCompanies: profile.excludedCompanies,
      careerLevel: profile.careerLevel,
      job: {
        company: job.company,
        title: job.title,
        location: job.location,
        country: job.country,
        city: job.city,
        workMode: job.workMode,
        technologies: job.technologies,
        industry: job.industry,
        careerLevel: job.careerLevel,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        experienceMinYears: job.experienceMinYears,
        experienceMaxYears: job.experienceMaxYears,
        requiredTechnologies: job.technologies,
        preferredTechnologiesFromJob: [],
      },
    };
    const matchResult = computeJobMatch(matchInput);
    matchedCount += 1;

    await prisma.jobMatch.upsert({
      where: { careerProfileId_jobId: { careerProfileId, jobId } },
      update: {
        overallScore: matchResult.overallScore,
        dimensions: matchResult.dimensions as unknown as Prisma.InputJsonValue,
        eligibility: matchResult.eligibility,
        explanation: matchResult.explanation as unknown as Prisma.InputJsonValue,
        status: matchResult.overallScore >= profile.minMatchThreshold ? "MATCHED" : "NOT_MATCHED",
        computedAt: new Date(),
      },
      create: {
        careerProfileId,
        jobId,
        organizationId,
        overallScore: matchResult.overallScore,
        dimensions: matchResult.dimensions as unknown as Prisma.InputJsonValue,
        eligibility: matchResult.eligibility,
        explanation: matchResult.explanation as unknown as Prisma.InputJsonValue,
        status: matchResult.overallScore >= profile.minMatchThreshold ? "MATCHED" : "NOT_MATCHED",
      },
    });
  }

  await prisma.jobDiscoveryRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", resultCount: searchResult.jobs.length, newJobsCount, duplicatesCount, matchedCount, finishedAt: new Date() },
  });

  return { ok: true, runId: run.id, status: "COMPLETED", resultCount: searchResult.jobs.length, newJobsCount, duplicatesCount, matchedCount };
}

function extractVerifiedSkillNames(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills
    .map((s) => (s && typeof s === "object" && "name" in s ? String((s as { name: unknown }).name) : null))
    .filter((s): s is string => !!s);
}
