import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";

import { enrichCompany, isStale, DEFAULT_STALE_DAYS, HIGH_VALUE_STALE_DAYS } from "./enrichment";

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — scheduled re-enrichment,
 * using the EXISTING scheduler (registry.ts), the same opt-in
 * `LeadDiscoveryConfig.discoveryEnabled` gate as its three siblings
 * (company-research-backlog, decision-maker-sync, website-intelligence-sync
 * — see registry.ts's top-of-file comment for why: every one of these makes
 * real AI calls, so none may run unattended for an org that hasn't opted
 * into autonomous background processing).
 *
 * Two-tier freshness policy, per spec: a company with at least one
 * non-DISMISSED LeadOpportunity ("high-value" — same definition
 * decision-maker-sync-job.ts already uses for "qualified") is re-enriched
 * after HIGH_VALUE_STALE_DAYS; every other company waits DEFAULT_STALE_DAYS.
 * Bounded per org per run (same MAX_PER_TIER-per-org discipline as every
 * sibling job) — this job runs on the existing 30-minute cadence, so the
 * backlog still drains steadily without ever processing an unbounded batch
 * in one tick.
 */
const MAX_PER_TIER_PER_ORG = 5;

export interface StaleReenrichmentSummary {
  organizationId: string;
  highValueProcessed: number;
  normalProcessed: number;
  completed: number;
  partial: number;
  failed: number;
}

export async function runStaleCompanyReenrichment(): Promise<JobRunLog[]> {
  const configs = await prisma.leadDiscoveryConfig.findMany({ where: { discoveryEnabled: true }, select: { organizationId: true } });
  if (configs.length === 0) {
    return [{ level: "info", message: "Skipped — no organization has discovery/background enrichment enabled." }];
  }

  const logs: JobRunLog[] = [];
  const summaries: StaleReenrichmentSummary[] = [];

  for (const config of configs) {
    const organizationId = config.organizationId;
    let completed = 0;
    let partial = 0;
    let failed = 0;

    // Tier 1: high-value (has an active LeadOpportunity), shorter threshold.
    const highValueCandidates = await prisma.company.findMany({
      where: {
        organizationId,
        enrichmentStatus: { notIn: ["RUNNING", "QUEUED"] },
        leadOpportunities: { some: { status: { not: "DISMISSED" } } },
      },
      orderBy: { lastEnrichedAt: "asc" },
      take: MAX_PER_TIER_PER_ORG * 3, // over-fetch, isStale() filters below (lastEnrichedAt-null-first ordering means real candidates cluster early, but a plain orderBy can't express the OR itself)
      select: { id: true, lastEnrichedAt: true },
    });
    const highValueDue = highValueCandidates.filter((c) => isStale(c.lastEnrichedAt, HIGH_VALUE_STALE_DAYS)).slice(0, MAX_PER_TIER_PER_ORG);

    for (const company of highValueDue) {
      try {
        const { status } = await enrichCompany(company.id, { triggeredBy: "SCHEDULED" });
        if (status === "COMPLETED") completed += 1;
        else if (status === "PARTIAL") partial += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        logs.push({
          level: "error",
          message: `Stale re-enrichment failed for high-value company ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
          organizationId,
        });
      }
    }

    // Tier 2: everything else, longer threshold — excludes tier-1 ids so a
    // company already processed above this run is never double-counted.
    const normalCandidates = await prisma.company.findMany({
      where: {
        organizationId,
        enrichmentStatus: { notIn: ["RUNNING", "QUEUED"] },
        id: { notIn: highValueDue.map((c) => c.id) },
      },
      orderBy: { lastEnrichedAt: "asc" },
      take: MAX_PER_TIER_PER_ORG * 3,
      select: { id: true, lastEnrichedAt: true },
    });
    const normalDue = normalCandidates.filter((c) => isStale(c.lastEnrichedAt, DEFAULT_STALE_DAYS)).slice(0, MAX_PER_TIER_PER_ORG);

    for (const company of normalDue) {
      try {
        const { status } = await enrichCompany(company.id, { triggeredBy: "SCHEDULED" });
        if (status === "COMPLETED") completed += 1;
        else if (status === "PARTIAL") partial += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        logs.push({
          level: "error",
          message: `Stale re-enrichment failed for company ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
          organizationId,
        });
      }
    }

    summaries.push({ organizationId, highValueProcessed: highValueDue.length, normalProcessed: normalDue.length, completed, partial, failed });
  }

  const totalProcessed = summaries.reduce((sum, s) => sum + s.highValueProcessed + s.normalProcessed, 0);
  const totalCompleted = summaries.reduce((sum, s) => sum + s.completed, 0);
  const totalPartial = summaries.reduce((sum, s) => sum + s.partial, 0);
  const totalFailed = summaries.reduce((sum, s) => sum + s.failed, 0);

  logs.push({
    level: "info",
    message: `Re-enriched ${totalProcessed} stale compan(ies) across ${summaries.length} org(s): ${totalCompleted} completed, ${totalPartial} partial, ${totalFailed} failed.`,
  });

  return logs;
}
