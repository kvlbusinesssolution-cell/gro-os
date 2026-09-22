import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";
import { runForecastEngine } from "./run";

/**
 * Phase 12 (Predictive Revenue Engine) — scheduled daily run. Mirrors
 * src/lib/learning/job.ts's own per-org loop exactly. runForecastEngine is
 * idempotent (every write goes through writePredictionSnapshot's
 * supersede-not-overwrite pattern) — safe to rerun, and "Run now" from the
 * Jobs control panel calls this same function.
 */
export async function runForecastEngineJob(): Promise<JobRunLog[]> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];

  for (const org of organizations) {
    const result = await runForecastEngine(org.id);
    if (result.error) {
      logs.push({ level: "error", message: `Forecast engine run failed: ${result.error}`, organizationId: org.id });
      continue;
    }
    logs.push({
      level: "info",
      message: `${result.openDealsProcessed} open deal(s) processed; ${result.orgSnapshotsWritten} org-level snapshot(s) written; ${result.maturedPredictionsEvaluated} matured prediction(s) evaluated; calibration ${result.calibrationPersisted ? "persisted" : "skipped (insufficient data)"} (${result.durationMs}ms).`,
      organizationId: org.id,
    });
  }

  logs.push({ level: "info", message: `Forecast engine run complete across ${organizations.length} org(s).` });
  return logs;
}
