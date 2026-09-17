import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";

import { discoverPotentialPartners } from "./partner-discovery";

/**
 * Partner Discovery Sync (Phase 8 — Partner & Referral Client Acquisition
 * Engine). Turns the manually-triggerable `discoverPotentialPartners
 * (organizationId)` (src/lib/business-development/partner-discovery.ts) into
 * a real scheduled background job.
 *
 * Same opt-in gate as decision-maker-sync/company-research-backlog/website-
 * intelligence-sync (see registry.ts's top-of-file comment):
 * `discoverPotentialPartners` makes a real AI call with live web search, so
 * it must never run unattended for an organization that hasn't opted into
 * autonomous background processing via `LeadDiscoveryConfig.discoveryEnabled`.
 *
 * Cadence is WEEKLY (see registry.ts), not every-30-minutes like the sibling
 * jobs above — partner discovery is a much lower-frequency need than lead/
 * decision-maker discovery (an org needs a handful of good referral
 * partners, not a continuously refreshed backlog), so a lower cadence both
 * matches real-world need and keeps AI spend proportionate.
 */
export async function runPartnerDiscoverySync(): Promise<JobRunLog[]> {
  const configs = await prisma.leadDiscoveryConfig.findMany({
    where: { discoveryEnabled: true },
    select: { organizationId: true },
  });

  if (configs.length === 0) {
    return [{ level: "info", message: "Skipped — no organization has discovery/background enrichment enabled." }];
  }

  const logs: JobRunLog[] = [];
  let orgsProcessed = 0;
  let partnersFound = 0;
  let partnersCreated = 0;
  let errors = 0;

  for (const config of configs) {
    const organizationId = config.organizationId;
    orgsProcessed += 1;
    try {
      const result = await discoverPotentialPartners(organizationId);
      partnersFound += result.found;
      partnersCreated += result.created;
      logs.push({
        level: "info",
        message: `${result.found} potential partner(s) found, ${result.created} new CANDIDATE partner(s) created.`,
        organizationId,
      });
    } catch (error) {
      errors += 1;
      logs.push({
        level: "error",
        message: `Partner discovery failed for organization ${organizationId}: ${error instanceof Error ? error.message : String(error)}`,
        organizationId,
      });
    }
  }

  logs.push({
    level: "info",
    message: `Processed ${orgsProcessed} opted-in organization(s): ${partnersFound} potential partner(s) found, ${partnersCreated} created, ${errors} error(s).`,
  });

  return logs;
}
