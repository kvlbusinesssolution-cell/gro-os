import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";

import { discoverDecisionMakers } from "./decision-maker-discovery";

/**
 * Decision Maker Sync (Phase 3 — Decision Maker Intelligence). Turns the
 * already-shipped, manually-triggered-only `discoverDecisionMakers(companyId)`
 * (src/lib/business-development/decision-maker-discovery.ts) into a real
 * scheduled background job, mirroring `company-research-backlog`'s (and
 * `website-intelligence-sync`'s) exact structure: opt-in gated, per-org loop,
 * bounded batch per org per run, retry-safe try/catch-per-item.
 *
 * Same opt-in gate as those two siblings (see registry.ts's top-of-file
 * comment): `discoverDecisionMakers` makes a real AI call with live web
 * search, so it must never run unattended for an organization that hasn't
 * opted into autonomous background processing via
 * `LeadDiscoveryConfig.discoveryEnabled`.
 *
 * "Qualified" per spec ("For a qualified company/opportunity identify...")
 * is read here as: has at least one `LeadOpportunity` — a company Growth OS
 * has already judged worth pursuing, not merely a raw discovered lead. This
 * job additionally only targets companies with zero `DecisionMaker` rows yet
 * — `discoverDecisionMakers` itself is idempotent (it re-verifies/updates an
 * already-known person by name rather than duplicating), but this job's
 * purpose is initial coverage across the qualified backlog, not continuous
 * re-verification of companies already covered; a company can always be
 * manually re-triggered later from its detail page if the app exposes that.
 */
const MAX_COMPANIES_PER_ORG_PER_RUN = 5;

export async function runDecisionMakerSync(): Promise<JobRunLog[]> {
  const configs = await prisma.leadDiscoveryConfig.findMany({
    where: { discoveryEnabled: true },
    select: { organizationId: true },
  });

  if (configs.length === 0) {
    return [{ level: "info", message: "Skipped — no organization has discovery/background enrichment enabled." }];
  }

  const logs: JobRunLog[] = [];
  let companiesProcessed = 0;
  let decisionMakersFound = 0;
  let decisionMakersCreated = 0;
  let errors = 0;

  for (const config of configs) {
    const organizationId = config.organizationId;

    // Scoped by organizationId directly on Company (never trusting a nested
    // relation alone) — matches the multi-tenant scoping pattern every other
    // job in registry.ts uses. "Qualified" = has at least one LeadOpportunity;
    // "not yet covered" = zero DecisionMaker rows so far.
    const companies = await prisma.company.findMany({
      where: {
        organizationId,
        leadOpportunities: { some: {} },
        decisionMakers: { none: {} },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_COMPANIES_PER_ORG_PER_RUN,
      select: { id: true },
    });

    for (const company of companies) {
      companiesProcessed += 1;
      try {
        const result = await discoverDecisionMakers(company.id);
        decisionMakersFound += result.found;
        decisionMakersCreated += result.created;
      } catch (error) {
        errors += 1;
        logs.push({
          level: "error",
          message: `Decision-maker discovery failed for company ${company.id}: ${error instanceof Error ? error.message : String(error)}`,
          organizationId,
        });
      }
    }
  }

  logs.push({
    level: "info",
    message: `Processed ${companiesProcessed} qualified company(ies): ${decisionMakersFound} decision-maker(s) found, ${decisionMakersCreated} created, ${errors} error(s).`,
  });

  return logs;
}
