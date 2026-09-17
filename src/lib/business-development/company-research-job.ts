import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateCompanyIntelligence } from "@/lib/company-intelligence";

import { generateLeadOpportunities } from "./opportunity-engine";
import { generateBuyerPersonas } from "./buyer-persona";
import { computeIntentScore } from "./intent-scoring";
import { computeOpportunityScore } from "./opportunity-priority";

/**
 * Bulk/scheduled Company Research (spec §"COMPANY RESEARCH") — processes a
 * bounded backlog of companies missing `CompanyIntelligence`, chaining the
 * existing `generateCompanyIntelligence()` (unchanged, previously only
 * manually triggered from a Company's detail page) with the two genuinely
 * new Phase 17 calls. Bounded per org per run for the same cost-control
 * reason as the discovery job — an unattended job processing an unbounded
 * backlog would be a real AI-spend risk.
 *
 * Phase 4 addition — deterministic scoring, wired at the exact moment the
 * data it depends on becomes fresh, rather than as a separate slow-polling
 * job: `computeIntentScore`/`computeOpportunityScore` (intent-scoring.ts /
 * opportunity-priority.ts) make no AI call, so there's no cost-control
 * reason to defer them — only a freshness reason to run them right here:
 *   - computeIntentScore(company.id) right after generateCompanyIntelligence()
 *     succeeds — that's the exact moment fresh growth/hiring/expansion
 *     signals exist for that company.
 *   - computeOpportunityScore(opportunity.id) for every opportunity that's
 *     still unscored right after generateLeadOpportunities() returns — that
 *     covers both freshly-created opportunities for this company AND, as a
 *     side effect, any pre-existing unscored opportunity for this same
 *     company (harmless — computeOpportunityScore is idempotent).
 * Each scoring call is wrapped in its OWN try/catch so a scoring failure
 * never aborts the per-company loop or blocks the next step
 * (generateLeadOpportunities / generateBuyerPersonas) from still running —
 * it's logged and the loop continues. Both compute functions upsert, so
 * re-running the whole job (or a partial retry) is always safe.
 *
 * Backlog catch-up (companies/opportunities that existed before this phase
 * shipped, so the per-company loop above — which only targets companies
 * with ZERO CompanyIntelligence runs — will never revisit them): rather
 * than a separate job, this is a second small, capped, same-opt-in-gate
 * pass inside this same job, per org per run, after the main loop. It's
 * cheap (no AI call) and belongs next to the scoring it's catching up on;
 * a whole separate job/cron entry for "run these two already-tested
 * deterministic functions on old rows" would be more moving parts for no
 * real benefit, and this job already runs every 30 minutes so the backlog
 * drains quickly without needing its own schedule.
 */
const MAX_COMPANIES_PER_RUN = 5;
const MAX_SCORING_BACKLOG_PER_RUN = 10;

export interface CompanyResearchRunSummary {
  organizationId: string;
  processed: number;
  failed: number;
  intentScoresComputed: number;
  opportunityScoresComputed: number;
  scoringErrors: string[];
  skippedReason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCompanyResearchBacklog(): Promise<CompanyResearchRunSummary[]> {
  if (!isAIConnected())
    return [
      {
        organizationId: "*",
        processed: 0,
        failed: 0,
        intentScoresComputed: 0,
        opportunityScoresComputed: 0,
        scoringErrors: [],
        skippedReason: "AI provider not configured",
      },
    ];

  const configs = await prisma.leadDiscoveryConfig.findMany({ where: { discoveryEnabled: true }, select: { organizationId: true } });
  const summaries: CompanyResearchRunSummary[] = [];

  for (const config of configs) {
    const organizationId = config.organizationId;

    const companies = await prisma.company.findMany({
      where: { organizationId, intelligenceRuns: { none: {} } },
      orderBy: { createdAt: "asc" },
      take: MAX_COMPANIES_PER_RUN,
      select: { id: true },
    });

    let processed = 0;
    let failed = 0;
    let intentScoresComputed = 0;
    let opportunityScoresComputed = 0;
    const scoringErrors: string[] = [];

    for (const company of companies) {
      try {
        await generateCompanyIntelligence(company.id);

        // Own try/catch — a scoring failure here must never block
        // generateLeadOpportunities/generateBuyerPersonas from still
        // running for this company.
        try {
          await computeIntentScore(company.id);
          intentScoresComputed += 1;
        } catch (error) {
          const message = `Intent scoring failed for company ${company.id}: ${errorMessage(error)}`;
          console.error(`[business-development/company-research-job] ${message}`);
          scoringErrors.push(message);
        }

        await generateLeadOpportunities(company.id);

        // generateLeadOpportunities only returns a count, so read back
        // this company's still-unscored opportunities (naturally scoped to
        // this company/org via the companyId filter — the loop never
        // passes an id belonging to another org).
        const unscoredOpportunities = await prisma.leadOpportunity.findMany({
          where: { companyId: company.id, opportunityScore: null },
          select: { id: true },
        });
        for (const opportunity of unscoredOpportunities) {
          try {
            await computeOpportunityScore(opportunity.id);
            opportunityScoresComputed += 1;
          } catch (error) {
            const message = `Opportunity scoring failed for opportunity ${opportunity.id} (company ${company.id}): ${errorMessage(error)}`;
            console.error(`[business-development/company-research-job] ${message}`);
            scoringErrors.push(message);
          }
        }

        await generateBuyerPersonas(company.id);
        processed += 1;
      } catch (error) {
        console.error(`[business-development/company-research-job] company ${company.id} failed:`, error);
        failed += 1;
      }
    }

    // Backlog catch-up — bounded, opt-in-gated the same way (this whole
    // block only runs for orgs already selected above via
    // LeadDiscoveryConfig.discoveryEnabled), scoped to this org via
    // `organizationId` on Company / `company: { organizationId }` on
    // LeadOpportunity.
    const companiesNeedingIntentScore = await prisma.company.findMany({
      where: { organizationId, intelligenceRuns: { some: {} }, intentScore: null },
      orderBy: { createdAt: "asc" },
      take: MAX_SCORING_BACKLOG_PER_RUN,
      select: { id: true },
    });
    for (const company of companiesNeedingIntentScore) {
      try {
        await computeIntentScore(company.id);
        intentScoresComputed += 1;
      } catch (error) {
        const message = `Intent scoring backlog catch-up failed for company ${company.id}: ${errorMessage(error)}`;
        console.error(`[business-development/company-research-job] ${message}`);
        scoringErrors.push(message);
      }
    }

    const opportunitiesNeedingScore = await prisma.leadOpportunity.findMany({
      where: { opportunityScore: null, company: { organizationId } },
      orderBy: { createdAt: "asc" },
      take: MAX_SCORING_BACKLOG_PER_RUN,
      select: { id: true },
    });
    for (const opportunity of opportunitiesNeedingScore) {
      try {
        await computeOpportunityScore(opportunity.id);
        opportunityScoresComputed += 1;
      } catch (error) {
        const message = `Opportunity scoring backlog catch-up failed for opportunity ${opportunity.id}: ${errorMessage(error)}`;
        console.error(`[business-development/company-research-job] ${message}`);
        scoringErrors.push(message);
      }
    }

    summaries.push({ organizationId, processed, failed, intentScoresComputed, opportunityScoresComputed, scoringErrors });
  }

  return summaries;
}
