import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";
import { syncCompanyTechnologiesFromScan } from "@/lib/scanner/technology-evidence-sync";

import { buildWebsiteIntelligenceEvidence } from "./website-intelligence";

/**
 * Website Intelligence Sync (Phase 1 AI Lead Discovery & Company Intelligence
 * Engine — the one genuinely new job this phase needs). `syncCompanyTechnologiesFromScan`
 * (src/lib/scanner/technology-evidence-sync.ts) and `buildWebsiteIntelligenceEvidence`
 * (src/lib/business-development/website-intelligence.ts) both already exist and are
 * both idempotent (they skip any CompanyEvidence fact that already exists), but
 * nothing calls either of them on a schedule — today they only run if a human opens
 * a Company page and triggers them manually. This job is what makes a completed
 * WebsiteScan turn into real, evidence-linked Company data automatically.
 *
 * Same opt-in gating as lead-discovery/company-research-backlog (see registry.ts's
 * top-of-file comment): `buildWebsiteIntelligenceEvidence` makes a real AI call
 * (via generateStructured) to turn raw audit facts into AI_INTERPRETATION evidence,
 * so — like those two sibling jobs — this only runs for organizations that have
 * opted into autonomous background processing via `LeadDiscoveryConfig.discoveryEnabled`.
 * Unlike company-research-backlog, it is NOT gated on `isAIConnected()` globally: the
 * RAW_FACT writes (both technology detections and audit numbers) are pure Prisma
 * work with zero AI dependency, and `buildWebsiteIntelligenceEvidence` already
 * degrades gracefully — catching any AI failure internally and still returning the
 * facts it wrote — so real, useful work still happens even with no AI provider
 * configured; only the AI_INTERPRETATION step silently yields 0 in that case.
 *
 * Bounded per org per run (cost/rate control, matching MAX_COMPANIES_PER_RUN's
 * convention in company-research-job.ts) and scoped to recent scans (WebsiteScans
 * are infrequent, human-triggered events — a 7-day lookback plus a per-run cap keeps
 * this cheap without needing its own "already processed" tracking table; the two
 * functions' own idempotency already makes reprocessing a no-op).
 */
const MAX_SCANS_PER_ORG_PER_RUN = 10;
const LOOKBACK_DAYS = 7;

export async function runWebsiteIntelligenceSync(): Promise<JobRunLog[]> {
  const configs = await prisma.leadDiscoveryConfig.findMany({
    where: { discoveryEnabled: true },
    select: { organizationId: true },
  });

  const logs: JobRunLog[] = [];
  let scansProcessed = 0;
  let technologyEvidenceCreated = 0;
  let factsCreated = 0;
  let interpretationsCreated = 0;
  let errors = 0;

  if (configs.length === 0) {
    return [{ level: "info", message: "Skipped — no organization has discovery/background enrichment enabled." }];
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  for (const config of configs) {
    const organizationId = config.organizationId;

    // Scoped by organizationId directly on WebsiteScan (never trusting a
    // company relation alone) — matches the multi-tenant scoping pattern
    // every other job in registry.ts uses. Only COMPLETED scans that are
    // actually linked to a Company have anything for these two functions to
    // read (SEO/Performance/UX/Security audits + detected Technology rows).
    const scans = await prisma.websiteScan.findMany({
      where: {
        organizationId,
        companyId: { not: null },
        status: "COMPLETED",
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_SCANS_PER_ORG_PER_RUN,
      select: { id: true, companyId: true },
    });

    for (const scan of scans) {
      // Narrowed above by `companyId: { not: null }`, but Prisma's generated
      // type still allows null — guard so the two calls below stay typesafe.
      if (!scan.companyId) continue;
      scansProcessed += 1;

      try {
        const techResult = await syncCompanyTechnologiesFromScan(scan.companyId, scan.id);
        technologyEvidenceCreated += techResult.evidenceCreated;
      } catch (error) {
        errors += 1;
        logs.push({
          level: "error",
          message: `Technology evidence sync failed for scan ${scan.id} (company ${scan.companyId}): ${error instanceof Error ? error.message : String(error)}`,
          organizationId,
        });
      }

      try {
        const intelResult = await buildWebsiteIntelligenceEvidence(scan.companyId, scan.id);
        factsCreated += intelResult.factsCreated;
        interpretationsCreated += intelResult.interpretationsCreated;
      } catch (error) {
        errors += 1;
        logs.push({
          level: "error",
          message: `Website intelligence evidence failed for scan ${scan.id} (company ${scan.companyId}): ${error instanceof Error ? error.message : String(error)}`,
          organizationId,
        });
      }
    }
  }

  logs.push({
    level: "info",
    message: `Processed ${scansProcessed} website scan(s): ${technologyEvidenceCreated} technology evidence row(s), ${factsCreated} audit fact(s), ${interpretationsCreated} AI interpretation(s), ${errors} error(s).`,
  });

  return logs;
}
