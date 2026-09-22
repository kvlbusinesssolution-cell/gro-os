import { prisma } from "@/lib/prisma";
import type { LearningPatternType, LearningRecommendationStatus } from "@/generated/prisma/client";
import { getLearningHealth } from "./health";
import { getLearningDataQualityReport } from "./data-quality";

/** §39 dashboard Overview + §57 GET /learning/overview — the one real read-time summary, every number traceable back to a real table (§41). */
export async function getLearningOverview(organizationId: string) {
  const [health, dataQuality, patternCounts, recommendationsPending, latestPatterns] = await Promise.all([
    getLearningHealth(organizationId),
    getLearningDataQualityReport(organizationId),
    prisma.learningPattern.groupBy({ by: ["sampleClassification"], where: { organizationId, status: { not: "RETIRED" } }, _count: true }),
    prisma.learningRecommendation.count({ where: { organizationId, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } }),
    prisma.learningPattern.findMany({ where: { organizationId, status: { in: ["EMERGING", "ACTIVE"] } }, orderBy: { lastObservedAt: "desc" }, take: 5 }),
  ]);

  return {
    health,
    dataQuality,
    patternCounts: Object.fromEntries(patternCounts.map((p) => [p.sampleClassification, p._count])),
    recommendationsPending,
    recentPatterns: latestPatterns,
  };
}

export interface ListPatternsFilters {
  patternType?: LearningPatternType;
  cursor?: string;
  limit?: number;
}

/** §57 GET /learning/patterns — paginated, never loads the full table into memory (§59). */
export async function listPatterns(organizationId: string, filters: ListPatternsFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);
  const patterns = await prisma.learningPattern.findMany({
    where: { organizationId, status: { not: "RETIRED" }, ...(filters.patternType ? { patternType: filters.patternType } : {}) },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = patterns.length > limit;
  return { patterns: patterns.slice(0, limit), nextCursor: hasMore ? patterns[limit - 1]!.id : null };
}

/** §41 clickable evidence drill-down — the real companies/opportunities/deals/revenue behind a pattern. */
export async function getPatternWithEvidence(organizationId: string, patternId: string) {
  const pattern = await prisma.learningPattern.findFirst({ where: { id: patternId, organizationId } });
  if (!pattern) return null;

  const observations = await prisma.learningObservation.findMany({
    where: { id: { in: pattern.evidenceIds }, organizationId },
    include: undefined,
  });

  const companyIds = [...new Set(observations.map((o) => o.companyId).filter((v): v is string => !!v))];
  const companies = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, industry: true, headquartersCountry: true, status: true } });
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const evidence = observations.map((o) => ({
    observationId: o.id,
    company: o.companyId ? (companyById.get(o.companyId) ?? null) : null,
    leadOpportunityId: o.leadOpportunityId || null,
    dealId: o.dealId,
    proposalId: o.proposalId,
    meetingId: o.meetingId,
    outcome: o.outcome,
    revenue: o.revenue,
    stageTimestamps: o.stageTimestamps,
  }));

  return { pattern, evidence };
}

export interface LearningInsight {
  text: string;
  href: string;
}

/**
 * §42 Revenue Command Center integration. Every bullet is generated from a
 * real, currently-active row — never generic AI motivational text (§42).
 * Returns [] (not a placeholder message) when there is nothing real to say.
 */
export async function getLearningInsightsSummary(organizationId: string): Promise<LearningInsight[]> {
  const [emergingCount, highValuePatterns, recommendationsPending, uncalibratedIntent] = await Promise.all([
    prisma.learningPattern.count({ where: { organizationId, status: "EMERGING" } }),
    prisma.learningPattern.findMany({ where: { organizationId, patternType: "HIGH_VALUE", status: { in: ["EMERGING", "ACTIVE"] } }, take: 3 }),
    prisma.learningRecommendation.count({ where: { organizationId, status: "PROPOSED" } }),
    prisma.learningPattern.count({ where: { organizationId, patternType: { in: ["WINNING_PATTERN"] }, sampleClassification: { in: ["OBSERVED", "STRONG_OBSERVATION"] } } }),
  ]);

  const insights: LearningInsight[] = [];
  if (emergingCount > 0) insights.push({ text: `${emergingCount} emerging pattern${emergingCount === 1 ? "" : "s"} detected this period.`, href: "/dashboard/learning/patterns" });
  for (const p of highValuePatterns) {
    insights.push({ text: `High-value pattern: ${p.name} (n=${p.sampleSize}, ${p.confidence} confidence) — review before acting on it.`, href: `/dashboard/learning/patterns/${p.id}` });
  }
  if (recommendationsPending > 0) insights.push({ text: `${recommendationsPending} learning recommendation${recommendationsPending === 1 ? "" : "s"} awaiting review.`, href: "/dashboard/learning/recommendations" });
  if (uncalibratedIntent > 0) insights.push({ text: `${uncalibratedIntent} winning pattern${uncalibratedIntent === 1 ? "" : "s"} with a real (OBSERVED+) sample — see Patterns for evidence.`, href: "/dashboard/learning/patterns?type=WINNING_PATTERN" });

  return insights;
}

export interface ListRecommendationsFilters {
  status?: LearningRecommendationStatus;
}

export async function listRecommendations(organizationId: string, filters: ListRecommendationsFilters = {}) {
  return prisma.learningRecommendation.findMany({
    where: { organizationId, ...(filters.status ? { status: filters.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}
