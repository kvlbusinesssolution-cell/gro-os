import { prisma } from "@/lib/prisma";
import type { LearningEngineState } from "@/generated/prisma/client";

const STALE_AFTER_HOURS = 48;

export async function getLearningHealth(organizationId: string): Promise<LearningEngineState | null> {
  return prisma.learningEngineState.findUnique({ where: { organizationId } });
}

/** Recomputes the honest health status from real counts — never a fixed default (§48). */
export function deriveHealthStatus(state: { lastProcessedAt: Date | null; totalObservations: number; patternsSufficientData: number }): "HEALTHY" | "LIMITED_DATA" | "STALE" | "INSUFFICIENT_DATA" {
  if (state.totalObservations === 0) return "INSUFFICIENT_DATA";
  if (!state.lastProcessedAt) return "INSUFFICIENT_DATA";
  const hoursSinceRun = (Date.now() - state.lastProcessedAt.getTime()) / 3_600_000;
  if (hoursSinceRun > STALE_AFTER_HOURS) return "STALE";
  if (state.patternsSufficientData === 0) return "LIMITED_DATA";
  return "HEALTHY";
}
