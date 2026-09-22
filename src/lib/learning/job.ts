import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";
import { runLearningEngine } from "./run";

/**
 * Phase 11 (Closed-Loop Revenue Learning Engine) — scheduled daily run.
 * Mirrors revenue-attribution-job.ts's own per-org loop exactly.
 * runLearningEngine is idempotent/incremental (§50) — safe to rerun, and
 * "Run now" from the Jobs control panel calls this same function.
 */
export async function runLearningEngineJob(): Promise<JobRunLog[]> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];

  for (const org of organizations) {
    const result = await runLearningEngine(org.id);
    if (result.error) {
      logs.push({ level: "error", message: `Learning engine run failed: ${result.error}`, organizationId: org.id });
      continue;
    }
    logs.push({
      level: "info",
      message: `${result.observationsUpserted} observation(s) across ${result.companiesProcessed} companies; ${result.patternsCreated} pattern(s) created, ${result.patternsUpdated} updated, ${result.patternsRetired} retired; ${result.recommendationsCreated} recommendation(s) created; ${result.shadowScoresComputed} shadow score(s) computed (${result.durationMs}ms).`,
      organizationId: org.id,
    });
  }

  logs.push({ level: "info", message: `Learning engine run complete across ${organizations.length} org(s).` });
  return logs;
}
