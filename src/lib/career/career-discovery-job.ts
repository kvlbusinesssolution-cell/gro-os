import { prisma } from "@/lib/prisma";
import { runJobDiscoveryForProfile } from "./job-discovery";

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real scheduled
 * discovery (§34), reusing the EXISTING scheduler (registry.ts), same
 * opt-in-only discipline as lead-discovery/company-research-backlog:
 * only runs for a CareerProfile with `discoveryEnabled: true` — never
 * unattended for a profile that hasn't explicitly opted in (§35).
 *
 * WEEKLY-frequency profiles are additionally gated on a real 7-day check
 * against their own JobDiscoveryRun history — DAILY-frequency profiles
 * rely on the cron's own once-a-day cadence plus runJobDiscoveryForProfile's
 * built-in 4-hour cooldown.
 */
export interface CareerDiscoverySummary {
  careerProfileId: string;
  organizationId: string;
  skipped?: string;
  ok?: boolean;
  newJobsCount?: number;
  error?: string;
}

export async function runScheduledCareerJobDiscovery(): Promise<CareerDiscoverySummary[]> {
  const profiles = await prisma.careerProfile.findMany({
    where: { status: "ACTIVE", discoveryEnabled: true, discoveryFrequency: { in: ["DAILY", "WEEKLY"] } },
    select: { id: true, organizationId: true, discoveryFrequency: true },
  });

  const summaries: CareerDiscoverySummary[] = [];

  for (const profile of profiles) {
    if (profile.discoveryFrequency === "WEEKLY") {
      const lastRun = await prisma.jobDiscoveryRun.findFirst({
        where: { careerProfileId: profile.id, status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
      });
      if (lastRun && Date.now() - lastRun.startedAt.getTime() < 7 * 24 * 60 * 60 * 1000) {
        summaries.push({ careerProfileId: profile.id, organizationId: profile.organizationId, skipped: "Weekly cadence — last real run was under 7 days ago." });
        continue;
      }
    }

    const result = await runJobDiscoveryForProfile(profile.id, profile.organizationId, "SCHEDULED");
    summaries.push({
      careerProfileId: profile.id,
      organizationId: profile.organizationId,
      ok: result.ok,
      newJobsCount: result.newJobsCount,
      error: result.error,
    });
  }

  return summaries;
}
