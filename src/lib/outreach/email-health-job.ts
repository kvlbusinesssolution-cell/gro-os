import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";

import { evaluateSendingIdentityHealth } from "./sending-identity";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — the one new
 * scheduled job this phase needs. Counter resets and cooldown release are
 * already lazy (see sending-identity.ts's checkRateLimit) and Alert
 * visibility already comes free from the existing hourly
 * `smart-alerts-evaluation` job (EMAIL_DELIVERABILITY_RISK was added to its
 * RULES map, not a new alert pipeline). This job exists only to run the
 * real circuit-breaker check (evaluateSendingIdentityHealth, which pauses a
 * CRITICAL identity + its org's active campaigns as a side effect) at a
 * tighter cadence than the hourly alert cycle, since this is the safety-
 * critical phase — every 15 minutes, same cadence as smart-alerts-
 * evaluation, not more aggressive than necessary.
 */
export async function runEmailHealthCheck(): Promise<JobRunLog[]> {
  const identities = await prisma.sendingIdentity.findMany({ where: { status: { not: "PAUSED" } } });
  const logs: JobRunLog[] = [];
  let checked = 0;
  let newlyPaused = 0;

  for (const identity of identities) {
    checked += 1;
    try {
      const health = await evaluateSendingIdentityHealth(identity);
      if (health.action) {
        newlyPaused += 1;
        logs.push({
          level: "warn",
          message: `Sending identity ${identity.email} auto-paused: ${health.action}`,
          organizationId: identity.organizationId,
        });
      }
    } catch (error) {
      logs.push({
        level: "error",
        message: `Health check failed for sending identity ${identity.email}: ${error instanceof Error ? error.message : String(error)}`,
        organizationId: identity.organizationId,
      });
    }
  }

  logs.push({ level: "info", message: `Checked ${checked} sending identit${checked === 1 ? "y" : "ies"}, ${newlyPaused} newly paused.` });
  return logs;
}
