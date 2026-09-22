import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";
import { computeAttributionForOrganization } from "./revenue-attribution";

/**
 * Phase 7 (Revenue Attribution Engine) — scheduled recompute. Unlike its
 * siblings in stale-reenrichment-job.ts/decision-maker-sync-job.ts etc,
 * this is pure deterministic DB computation (no AI call, no per-org spend),
 * so it runs for every real organization, not gated behind
 * LeadDiscoveryConfig.discoveryEnabled. computeAttributionForInvoice is a
 * plain upsert (see revenue-attribution.ts), so rerunning this daily for
 * every paid invoice is safe and idempotent (§45) — it simply keeps every
 * attribution row's revenueAmount/evidence in sync with any invoices that
 * received a new/updated payment since the last run.
 */
export async function runRevenueAttributionRecompute(): Promise<JobRunLog[]> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let totalComputed = 0;

  for (const org of organizations) {
    try {
      const result = await computeAttributionForOrganization(org.id);
      totalComputed += result.computed;
      if (result.invoicesConsidered > 0) {
        logs.push({
          level: "info",
          message: `Recomputed attribution for ${result.computed}/${result.invoicesConsidered} paid invoice(s): ${result.direct} direct, ${result.assisted} assisted, ${result.unknown} unknown.`,
          organizationId: org.id,
        });
      }
    } catch (error) {
      logs.push({
        level: "error",
        message: `Revenue attribution recompute failed: ${error instanceof Error ? error.message : String(error)}`,
        organizationId: org.id,
      });
    }
  }

  logs.push({ level: "info", message: `Revenue attribution recompute complete — ${totalComputed} invoice(s) across ${organizations.length} org(s).` });
  return logs;
}
