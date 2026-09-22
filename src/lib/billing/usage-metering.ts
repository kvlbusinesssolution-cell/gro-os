import { prisma } from "@/lib/prisma";
import { getCached, setCached } from "@/lib/cache/redis-cache";
import type { Prisma, UsageMetricType } from "@/generated/prisma/client";

/**
 * Usage metering — an append-only UsageRecord ledger (real, timestamped
 * events, source of truth) with a short-TTL Redis cache in front of the
 * "current period total" read path so a plan-limit check on a hot request
 * path (e.g. "can this org create one more project?") doesn't re-aggregate
 * the whole period's rows on every single call. Cache unavailability
 * degrades to a real DB aggregation, never a fabricated/zero total (same
 * discipline as src/lib/cache/redis-cache.ts's own doc comment).
 */

const USAGE_CACHE_TTL_SECONDS = 60;

function currentBillingPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { periodStart, periodEnd };
}

function cacheKey(organizationId: string, metricType: UsageMetricType, periodStart: Date): string {
  return `usage:${organizationId}:${metricType}:${periodStart.toISOString().slice(0, 7)}`;
}

/** Records one real usage event — an actual automation run, an actual AI call's token count, an actual storage delta, etc. Never a synthetic/rounded estimate beyond what the caller genuinely measured. */
export async function recordUsage(organizationId: string, metricType: UsageMetricType, quantity: number, metadata?: Record<string, unknown>): Promise<void> {
  try {
    const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId }, select: { id: true } });
    if (!billingAccount) return;

    const { periodStart, periodEnd } = currentBillingPeriod();
    await prisma.usageRecord.create({
      data: { organizationId, billingAccountId: billingAccount.id, metricType, quantity, periodStart, periodEnd, metadata: metadata as Prisma.InputJsonValue | undefined },
    });

    // Invalidate rather than incrementally update the cache — the next
    // read recomputes a real, exact aggregate instead of drifting from
    // repeated increments under concurrent writers.
    const { invalidateCache } = await import("@/lib/cache/redis-cache");
    await invalidateCache(cacheKey(organizationId, metricType, periodStart));
  } catch (error) {
    console.error("[billing/usage-metering] recordUsage failed:", error);
  }
}

/** Real current-period usage total for one metric — Redis-cached for USAGE_CACHE_TTL_SECONDS, always backed by a real Prisma aggregate on a cache miss. */
export async function getCurrentPeriodUsage(organizationId: string, metricType: UsageMetricType): Promise<number> {
  const { periodStart, periodEnd } = currentBillingPeriod();
  const key = cacheKey(organizationId, metricType, periodStart);

  const cached = await getCached<number>(key);
  if (cached !== null) return cached;

  const aggregate = await prisma.usageRecord.aggregate({
    where: { organizationId, metricType, periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
    _sum: { quantity: true },
  });
  const total = aggregate._sum.quantity ?? 0;
  await setCached(key, total, USAGE_CACHE_TTL_SECONDS);
  return total;
}

/** Live, non-period-bucketed counts for metrics that represent a current STATE rather than an accumulating event count (USERS, WORKSPACES, PROJECTS, CRM_RECORDS, KNOWLEDGE_BASE_MB) — these are measured directly from the real current row counts, not summed from UsageRecord (which would double count a user who's been a member the whole period). */
export async function getCurrentStateUsage(organizationId: string, metricType: Extract<UsageMetricType, "USERS" | "WORKSPACES" | "PROJECTS" | "CRM_RECORDS" | "KNOWLEDGE_BASE_MB">): Promise<number> {
  switch (metricType) {
    case "USERS":
      return prisma.membership.count({ where: { organizationId, status: "ACTIVE" } });
    case "WORKSPACES":
      return prisma.workspace.count({ where: { organizationId } });
    case "PROJECTS":
      return prisma.project.count({ where: { organizationId } });
    case "CRM_RECORDS":
      return prisma.deal.count({ where: { organizationId } }).then(async (deals) => deals + (await prisma.contact.count({ where: { organizationId } })));
    case "KNOWLEDGE_BASE_MB": {
      const result = await prisma.knowledgeAttachment.aggregate({
        where: { article: { knowledgeBase: { workspace: { organizationId } } } },
        _sum: { sizeBytes: true },
      });
      return (result._sum.sizeBytes ?? 0) / (1024 * 1024);
    }
  }
}

/**
 * Batched USERS + PROJECTS state usage for many organizations at once — 2
 * groupBy queries total, not 2×N. Used by the Agency Portal's managed-tenant
 * roster (src/app/dashboard/agency/page.tsx), which previously called
 * getCurrentStateUsage(org.id, ...) twice per managed org inside a
 * `.map(async org => ...)` — a real N+1 for agencies with many tenants.
 * Only covers the two metrics that page actually needs; WORKSPACES/
 * CRM_RECORDS/KNOWLEDGE_BASE_MB aren't called in a loop anywhere today, so
 * they stay on the simple per-org getCurrentStateUsage above rather than
 * speculatively batching metrics nothing currently fans out over.
 */
export async function getCurrentStateUsageBatchUsersAndProjects(organizationIds: string[]): Promise<Map<string, { members: number; projects: number }>> {
  const result = new Map<string, { members: number; projects: number }>(organizationIds.map((id) => [id, { members: 0, projects: 0 }]));
  if (organizationIds.length === 0) return result;

  const [membershipCounts, projectCounts] = await Promise.all([
    prisma.membership.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
  ]);

  for (const row of membershipCounts) {
    const entry = result.get(row.organizationId);
    if (entry) entry.members = row._count._all;
  }
  for (const row of projectCounts) {
    const entry = result.get(row.organizationId);
    if (entry) entry.projects = row._count._all;
  }

  return result;
}

export interface PlanLimitCheck {
  allowed: boolean;
  limit: number | null; // null = unlimited
  current: number;
  reason?: string;
}

const PLAN_LIMIT_FIELD: Partial<Record<UsageMetricType, "userLimit" | "workspaceLimit" | "aiCreditsMonthly" | "storageMbLimit" | "projectLimit" | "clientLimit" | "automationRunsMonthly" | "knowledgeBaseMbLimit" | "apiCallsMonthly">> = {
  USERS: "userLimit",
  WORKSPACES: "workspaceLimit",
  AI_TOKENS: "aiCreditsMonthly",
  STORAGE_MB: "storageMbLimit",
  PROJECTS: "projectLimit",
  CRM_RECORDS: "clientLimit",
  AUTOMATION_RUNS: "automationRunsMonthly",
  KNOWLEDGE_BASE_MB: "knowledgeBaseMbLimit",
  API_CALLS: "apiCallsMonthly",
};

const STATE_METRICS = new Set<UsageMetricType>(["USERS", "WORKSPACES", "PROJECTS", "CRM_RECORDS", "KNOWLEDGE_BASE_MB"]);

/**
 * Real plan-limit enforcement check — call before an action that consumes a
 * limited resource (inviting a member, creating a workspace, etc). A metric
 * with no PLAN_LIMIT_FIELD mapping (BANDWIDTH_MB currently) always returns
 * allowed:true — tracked for visibility, not yet plan-gated.
 *
 * Two real gates, checked in order:
 *   1. Organization.isOwnerOrg (KVL Business Solutions' own tenant, the
 *      only org exempt from every plan) short-circuits to unlimited before
 *      touching BillingAccount/Plan at all.
 *   2. Every other org resolves its limit from `billingAccount.currentPlan`
 *      — but if that org has no BillingAccount yet (a pre-existing org
 *      that predates onboarding assigning one, or any other edge case),
 *      this falls back to the real FREE tier's limit for this metric
 *      rather than treating "no billing row" as unlimited. Only a
 *      genuinely CUSTOM/ENTERPRISE plan (whose own limit field is null)
 *      is actually unlimited.
 */
export async function checkPlanLimit(organizationId: string, metricType: UsageMetricType): Promise<PlanLimitCheck> {
  const limitField = PLAN_LIMIT_FIELD[metricType];
  if (!limitField) return { allowed: true, limit: null, current: 0 };

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isOwnerOrg: true, currency: true } });
  if (organization?.isOwnerOrg) {
    const current = STATE_METRICS.has(metricType)
      ? await getCurrentStateUsage(organizationId, metricType as never)
      : await getCurrentPeriodUsage(organizationId, metricType);
    return { allowed: true, limit: null, current };
  }

  const billingAccount = await prisma.billingAccount.findUnique({ where: { organizationId }, include: { currentPlan: true } });
  let limit: number | null;
  if (billingAccount?.currentPlan) {
    limit = billingAccount.currentPlan[limitField];
  } else {
    const { getDefaultFreePlan } = await import("./plan-catalog");
    const freePlan = await getDefaultFreePlan(organization?.currency ?? "USD");
    limit = freePlan?.[limitField] ?? null;
  }

  const current = STATE_METRICS.has(metricType)
    ? await getCurrentStateUsage(organizationId, metricType as never)
    : await getCurrentPeriodUsage(organizationId, metricType);

  if (limit === null) return { allowed: true, limit: null, current };
  if (current >= limit) return { allowed: false, limit, current, reason: `This organization's plan allows up to ${limit} for this resource — currently at ${current}.` };
  return { allowed: true, limit, current };
}
