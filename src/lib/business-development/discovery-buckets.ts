import type { Prisma } from "@/generated/prisma/client";

/**
 * AI Company Discovery dashboard (/dashboard/company-discovery) research-status
 * buckets. A Company can land in more than one bucket at once (e.g. a company
 * discovered an hour ago with only one source is both NEWLY_DISCOVERED and
 * UNVERIFIED) — these are independent boolean facets, not a mutually
 * exclusive partition, so both `classifyCompanyBuckets` (below, used to badge
 * an already-loaded company) and `buildDiscoveryBucketWhere` (used to filter
 * the Prisma query server-side) treat them that way.
 *
 * RESEARCH_FAILURE is an explicit proxy, not a real failure event: this
 * codebase has no failure-tracking field on CompanyIntelligence/ResearchNote
 * (checked prisma/schema.prisma — no `status`/`error` column on either
 * model), so "repeatedly rediscovered but enrichment never landed"
 * (sourceCount >= 2 with zero CompanyIntelligence rows) is the closest
 * honest signal available today.
 */
export const DISCOVERY_BUCKETS = [
  "NEWLY_DISCOVERED",
  "RECENTLY_RESEARCHED",
  "UNVERIFIED",
  "FULLY_RESEARCHED",
  "DUPLICATE_CANDIDATE",
  "RESEARCH_FAILURE",
] as const;

export type DiscoveryBucket = (typeof DISCOVERY_BUCKETS)[number];

export const DISCOVERY_BUCKET_LABEL: Record<DiscoveryBucket, string> = {
  NEWLY_DISCOVERED: "Newly discovered",
  RECENTLY_RESEARCHED: "Recently researched",
  UNVERIFIED: "Unverified",
  FULLY_RESEARCHED: "Fully researched",
  DUPLICATE_CANDIDATE: "Duplicate candidate",
  RESEARCH_FAILURE: "Research failure (proxy)",
};

export const DISCOVERY_BUCKET_DESCRIPTION: Record<DiscoveryBucket, string> = {
  NEWLY_DISCOVERED: "lastDiscoveredAt within the last 24 hours",
  RECENTLY_RESEARCHED: "has a CompanyIntelligence report generated in the last 7 days",
  UNVERIFIED: "discovered by exactly one source and never enriched with an intelligence report",
  FULLY_RESEARCHED: "has an intelligence report, evidence, and a lead score",
  DUPLICATE_CANDIDATE: "rediscovered by more than one source (sourceCount > 1)",
  RESEARCH_FAILURE: "rediscovered 2+ times but still has zero intelligence reports — an inferred proxy, not a real failure event",
};

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export interface DiscoveryBucketInput {
  sourceCount: number;
  lastDiscoveredAt: Date;
  /** Total CompanyIntelligence rows for this company. */
  intelligenceRunCount: number;
  /** createdAt of the most recent CompanyIntelligence row, or null if none exist. */
  latestIntelligenceRunAt: Date | null;
  /** Total CompanyEvidence rows for this company. */
  evidenceCount: number;
  hasLeadScore: boolean;
}

/**
 * Classifies an already-loaded Company (with its aggregate counts) into
 * every discovery bucket it currently belongs to. Pure — no Prisma calls —
 * so the page's data-fetching (buildDiscoveryBucketWhere below) and this
 * per-company badge logic can be unit-tested independently of Postgres.
 */
export function classifyCompanyBuckets(input: DiscoveryBucketInput, now: Date = new Date()): DiscoveryBucket[] {
  const buckets: DiscoveryBucket[] = [];
  const nowMs = now.getTime();

  if (nowMs - input.lastDiscoveredAt.getTime() <= ONE_DAY_MS) {
    buckets.push("NEWLY_DISCOVERED");
  }
  if (input.latestIntelligenceRunAt && nowMs - input.latestIntelligenceRunAt.getTime() <= SEVEN_DAYS_MS) {
    buckets.push("RECENTLY_RESEARCHED");
  }
  if (input.sourceCount === 1 && input.intelligenceRunCount === 0) {
    buckets.push("UNVERIFIED");
  }
  if (input.intelligenceRunCount > 0 && input.evidenceCount > 0 && input.hasLeadScore) {
    buckets.push("FULLY_RESEARCHED");
  }
  if (input.sourceCount > 1) {
    buckets.push("DUPLICATE_CANDIDATE");
  }
  if (input.sourceCount >= 2 && input.intelligenceRunCount === 0) {
    buckets.push("RESEARCH_FAILURE");
  }

  return buckets;
}

/**
 * Same bucket semantics as classifyCompanyBuckets, expressed as a real
 * Prisma `Company` where-clause so the /dashboard/company-discovery page can
 * filter server-side (never a fixed page loaded then filtered client-side).
 */
export function buildDiscoveryBucketWhere(bucket: DiscoveryBucket, now: Date = new Date()): Prisma.CompanyWhereInput {
  const since24h = new Date(now.getTime() - ONE_DAY_MS);
  const since7d = new Date(now.getTime() - SEVEN_DAYS_MS);

  switch (bucket) {
    case "NEWLY_DISCOVERED":
      return { lastDiscoveredAt: { gte: since24h } };
    case "RECENTLY_RESEARCHED":
      return { intelligenceRuns: { some: { createdAt: { gte: since7d } } } };
    case "UNVERIFIED":
      return { sourceCount: 1, intelligenceRuns: { none: {} } };
    case "FULLY_RESEARCHED":
      return { intelligenceRuns: { some: {} }, evidence: { some: {} }, leadScore: { isNot: null } };
    case "DUPLICATE_CANDIDATE":
      return { sourceCount: { gt: 1 } };
    case "RESEARCH_FAILURE":
      return { sourceCount: { gte: 2 }, intelligenceRuns: { none: {} } };
  }
}
