import { Queue, Worker, type Job as BullJob } from "bullmq";

import { prisma } from "@/lib/prisma";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { createRedisClient, type RedisLikeClient } from "@/lib/redis-client";
import { getGateway } from "./gateway/registry";
import { mapGatewayStatus } from "./subscriptions";
import { uninstallListing } from "@/lib/marketplace/install-engine";

/**
 * A dedicated BullMQ queue for the platform's recurring billing jobs —
 * copies src/lib/workflows/engine.ts's exact connection-caching scaffold
 * (separate Queue/Worker IORedis connections, globalThis-cached against Next
 * dev hot-reload duplication) rather than reusing the generic
 * src/lib/scheduler/* SchedulerProvider abstraction, per this phase's scope.
 *
 * Registration is lazy and idempotent (registerRecurringBillingJobs(),
 * mirroring engine.ts's ensureWorker()/BullMQProvider's
 * upsertJobScheduler pattern) — this module deliberately does not
 * self-register at import time; wiring registerRecurringBillingJobs() into
 * the app's real process bootstrap (src/instrumentation.ts /
 * src/lib/scheduler/init.ts) is out of this file's scope and left for that
 * integration step.
 */

const QUEUE_NAME = "kvl-billing-recurring";

type RecurringBillingJobName = "renewal-sweep" | "trial-reminder" | "dunning" | "credit-reset" | "growth-token-reset" | "marketplace-subscription-renewal-sweep";

interface RecurringBillingJobData {
  job: RecurringBillingJobName;
}

function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

const globalForBillingQueue = globalThis as unknown as {
  __billingRecurringRedisConnection?: RedisLikeClient;
  __billingRecurringWorkerConnection?: RedisLikeClient;
  __billingRecurringQueue?: Queue<RecurringBillingJobData>;
  __billingRecurringWorker?: Worker<RecurringBillingJobData>;
};

function getConnection(): RedisLikeClient {
  if (!globalForBillingQueue.__billingRecurringRedisConnection) {
    globalForBillingQueue.__billingRecurringRedisConnection = createRedisClient(getRedisUrl(), { maxRetriesPerRequest: null });
  }
  return globalForBillingQueue.__billingRecurringRedisConnection;
}

function getWorkerConnection(): RedisLikeClient {
  if (!globalForBillingQueue.__billingRecurringWorkerConnection) {
    globalForBillingQueue.__billingRecurringWorkerConnection = createRedisClient(getRedisUrl(), { maxRetriesPerRequest: null });
  }
  return globalForBillingQueue.__billingRecurringWorkerConnection;
}

function getQueue(): Queue<RecurringBillingJobData> {
  if (!globalForBillingQueue.__billingRecurringQueue) {
    globalForBillingQueue.__billingRecurringQueue = new Queue<RecurringBillingJobData>(QUEUE_NAME, { connection: getConnection() });
  }
  return globalForBillingQueue.__billingRecurringQueue;
}

/**
 * Real, gateway-verified renewal safety net — for every ACTIVE BillingAccount
 * whose currentPeriodEnd has already passed with a real gatewaySubscriptionId
 * on file, re-fetches the live subscription from its real gateway
 * (getGateway(provider).getSubscription) and syncs status/period from it.
 * Catches any renewal/cancellation webhook this app never received (dropped
 * delivery, an outage during the event) rather than silently trusting a
 * stale local period forever.
 */
async function runRenewalSweep(): Promise<void> {
  const now = new Date();
  const accounts = await prisma.billingAccount.findMany({
    where: { status: "ACTIVE", gatewaySubscriptionId: { not: null }, gatewayProvider: { not: null }, currentPeriodEnd: { lt: now } },
  });

  for (const account of accounts) {
    if (!account.gatewaySubscriptionId || !account.gatewayProvider) continue;
    try {
      const gateway = getGateway(account.gatewayProvider);
      if (!gateway.isConfigured()) continue;

      const snapshot = await gateway.getSubscription(account.gatewaySubscriptionId);
      if (!snapshot) continue;

      await prisma.billingAccount.update({
        where: { id: account.id },
        data: {
          status: mapGatewayStatus(snapshot.status),
          currentPeriodStart: snapshot.currentPeriodStart ?? account.currentPeriodStart,
          currentPeriodEnd: snapshot.currentPeriodEnd ?? account.currentPeriodEnd,
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        },
      });
    } catch (error) {
      console.error(`[billing/recurring-queue] renewal sweep failed for BillingAccount ${account.id}:`, error);
    }
  }
}

/**
 * Same reconciliation-net pattern as runRenewalSweep, scoped to
 * SUBSCRIPTION-priced MarketplaceInstall rows instead of BillingAccount —
 * for any ACTIVE marketplace subscription install past its real
 * currentPeriodEnd with a real gatewaySubscriptionId on file, re-fetches
 * the live subscription from its real gateway and syncs status/period.
 * Never itself charges — the gateway's own recurring billing does that;
 * this only syncs state and auto-uninstalls on real cancellation, exactly
 * like a platform subscription lapsing.
 */
async function runMarketplaceSubscriptionRenewalSweep(): Promise<void> {
  const now = new Date();
  const installs = await prisma.marketplaceInstall.findMany({
    where: { status: "ACTIVE", gatewaySubscriptionId: { not: null }, gatewayProvider: { not: null }, currentPeriodEnd: { lt: now } },
  });

  for (const install of installs) {
    if (!install.gatewaySubscriptionId || !install.gatewayProvider) continue;
    try {
      const gateway = getGateway(install.gatewayProvider);
      if (!gateway.isConfigured()) continue;

      const snapshot = await gateway.getSubscription(install.gatewaySubscriptionId);
      if (!snapshot) continue;

      const status = mapGatewayStatus(snapshot.status);
      if (status === "CANCELED") {
        await uninstallListing({ organizationId: install.organizationId, listingId: install.listingId, uninstalledByUserId: install.installedByUserId });
        continue;
      }

      await prisma.marketplaceInstall.update({
        where: { id: install.id },
        data: {
          currentPeriodStart: snapshot.currentPeriodStart ?? install.currentPeriodStart,
          currentPeriodEnd: snapshot.currentPeriodEnd ?? install.currentPeriodEnd,
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        },
      });
    } catch (error) {
      console.error(`[billing/recurring-queue] marketplace subscription sweep failed for MarketplaceInstall ${install.id}:`, error);
    }
  }
}

const TRIAL_REMINDER_WINDOW_DAYS = 3;

/** Real in-app notification (via notifyOrganizationOwners) to every org whose trial genuinely ends within the next 3 days. */
async function runTrialEndingReminder(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + TRIAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const accounts = await prisma.billingAccount.findMany({
    where: { trialEndsAt: { gte: now, lte: windowEnd }, status: { notIn: ["CANCELED"] } },
  });

  for (const account of accounts) {
    try {
      await notifyOrganizationOwners({
        organizationId: account.organizationId,
        type: "SYSTEM_NOTICE",
        title: "Your trial is ending soon",
        message: `Your GrowthOS trial ends on ${account.trialEndsAt?.toLocaleDateString()}. Add a payment method to keep your plan active without interruption.`,
      });
    } catch (error) {
      console.error(`[billing/recurring-queue] trial-ending reminder failed for BillingAccount ${account.id}:`, error);
    }
  }
}

/**
 * A real, configurable grace period — 7 days past due. Documented cutoff:
 * every day a BillingAccount is PAST_DUE, its owners are notified; once the
 * account has been past due for at least this many days (measured from the
 * most recent still-unpaid PlatformInvoice's issue date, falling back to the
 * BillingAccount's own updatedAt if none is on file), it's moved to PAUSED —
 * this app's real "access restricted" state for a non-gateway-initiated
 * pause — rather than left fully-featured with no consequence. This never
 * touches the gateway subscription itself; the gateway's own dunning/retry
 * logic (or a real cancelSubscription call from elsewhere) governs the
 * actual charge attempts.
 */
const DUNNING_GRACE_PERIOD_DAYS = 7;

async function runDunning(): Promise<void> {
  const now = new Date();
  const accounts = await prisma.billingAccount.findMany({ where: { status: "PAST_DUE" } });

  for (const account of accounts) {
    try {
      const unpaidInvoice = await prisma.platformInvoice.findFirst({
        where: { billingAccountId: account.id, status: { in: ["OPEN", "UNCOLLECTIBLE"] } },
        orderBy: { issuedAt: "desc" },
      });
      const pastDueSince = unpaidInvoice?.issuedAt ?? account.updatedAt;
      const daysPastDue = Math.floor((now.getTime() - pastDueSince.getTime()) / (24 * 60 * 60 * 1000));

      if (daysPastDue >= DUNNING_GRACE_PERIOD_DAYS) {
        await prisma.billingAccount.update({ where: { id: account.id }, data: { status: "PAUSED", pausedAt: now } });
        await notifyOrganizationOwners({
          organizationId: account.organizationId,
          type: "CRITICAL_ALERT",
          title: "Payment overdue — access restricted",
          message: `Payment has been overdue for ${daysPastDue} days. Access has been restricted pending payment — update your payment method to restore full access.`,
        });
      } else {
        await notifyOrganizationOwners({
          organizationId: account.organizationId,
          type: "CRITICAL_ALERT",
          title: "Payment overdue",
          message: `Payment is ${daysPastDue} day(s) overdue. Please update your payment method within ${DUNNING_GRACE_PERIOD_DAYS - daysPastDue} day(s) to avoid restricted access.`,
        });
      }
    } catch (error) {
      console.error(`[billing/recurring-queue] dunning failed for BillingAccount ${account.id}:`, error);
    }
  }
}

/** Real monthly AI-credit reset — for every AICreditLedger whose periodResetAt has passed, resets monthlyCreditsUsed to 0, advances periodResetAt by one real calendar month, and re-syncs monthlyCreditsGranted from the org's CURRENT Plan (covers a plan change since the last reset; 0 if the org has no plan on file). */
async function runCreditReset(): Promise<void> {
  const now = new Date();
  const ledgers = await prisma.aICreditLedger.findMany({
    where: { periodResetAt: { lte: now } },
    include: { billingAccount: { include: { currentPlan: true } } },
  });

  for (const ledger of ledgers) {
    try {
      const granted = ledger.billingAccount.currentPlan?.aiCreditsMonthly ?? 0;
      const nextReset = new Date(now);
      nextReset.setMonth(nextReset.getMonth() + 1);

      await prisma.aICreditLedger.update({
        where: { id: ledger.id },
        data: { monthlyCreditsUsed: 0, monthlyCreditsGranted: granted, periodResetAt: nextReset },
      });
    } catch (error) {
      console.error(`[billing/recurring-queue] credit reset failed for AICreditLedger ${ledger.id}:`, error);
    }
  }
}

/** Real monthly Growth Token reset — mirrors runCreditReset above exactly, for GrowthTokenLedger instead of AICreditLedger: for every ledger whose periodResetAt has passed, resets monthlyTokensUsed to 0, advances periodResetAt by one real calendar month, and re-syncs monthlyTokensGranted from the org's CURRENT Plan. Never touches purchasedTokensRemaining — bought tokens don't expire on a monthly cycle. Without this job, an org that exhausted its monthly Growth Token allowance stayed blocked every month after, with no way back short of buying purchased tokens — opportunistic reads (getGrowthTokenAvailability/spendGrowthTokens) also self-heal via resetLedgerIfDue, but this sweep covers orgs that go quiet without triggering either. */
async function runGrowthTokenReset(): Promise<void> {
  const now = new Date();
  const ledgers = await prisma.growthTokenLedger.findMany({
    where: { periodResetAt: { lte: now } },
    include: { billingAccount: { include: { currentPlan: true } } },
  });

  for (const ledger of ledgers) {
    try {
      const granted = ledger.billingAccount.currentPlan?.growthTokensMonthly ?? 0;
      const nextReset = new Date(now);
      nextReset.setMonth(nextReset.getMonth() + 1);

      await prisma.growthTokenLedger.update({
        where: { id: ledger.id },
        data: { monthlyTokensUsed: 0, monthlyTokensGranted: granted, periodResetAt: nextReset },
      });
    } catch (error) {
      console.error(`[billing/recurring-queue] growth token reset failed for GrowthTokenLedger ${ledger.id}:`, error);
    }
  }
}

async function processRecurringBillingJob(bullJob: BullJob<RecurringBillingJobData>): Promise<void> {
  switch (bullJob.data.job) {
    case "renewal-sweep":
      return runRenewalSweep();
    case "trial-reminder":
      return runTrialEndingReminder();
    case "dunning":
      return runDunning();
    case "credit-reset":
      return runCreditReset();
    case "growth-token-reset":
      return runGrowthTokenReset();
    case "marketplace-subscription-renewal-sweep":
      return runMarketplaceSubscriptionRenewalSweep();
  }
}

function ensureWorker(): void {
  if (globalForBillingQueue.__billingRecurringWorker) return;
  globalForBillingQueue.__billingRecurringWorker = new Worker<RecurringBillingJobData>(QUEUE_NAME, processRecurringBillingJob, {
    connection: getWorkerConnection(),
    concurrency: 1,
  });
  globalForBillingQueue.__billingRecurringWorker.on("failed", (bullJob, err) => {
    console.error(`[billing/recurring-queue] job "${bullJob?.data?.job}" failed:`, err);
  });
}

const JOB_SCHEDULES: Array<{ job: RecurringBillingJobName; cronExpression: string }> = [
  { job: "renewal-sweep", cronExpression: "0 2 * * *" }, // daily 02:00 — after most gateways' own renewal cycles have already fired for the day
  { job: "credit-reset", cronExpression: "0 1 * * *" }, // daily 01:00 — cheap to check daily even though each org's own period only actually resets monthly
  { job: "growth-token-reset", cronExpression: "5 1 * * *" }, // daily 01:05 — same cadence as credit-reset, offset 5 min to avoid contending for the same connection slot
  { job: "trial-reminder", cronExpression: "0 9 * * *" }, // daily 09:00 — a reasonable local-morning-ish send time
  { job: "dunning", cronExpression: "0 10 * * *" }, // daily 10:00
  { job: "marketplace-subscription-renewal-sweep", cronExpression: "30 2 * * *" }, // daily 02:30 — right after the platform renewal-sweep
];

/**
 * Idempotent — safe to call multiple times (e.g. on every hot reload in
 * dev); BullMQ's upsertJobScheduler updates an existing scheduler rather
 * than creating a duplicate one for the same jobSchedulerId (same real
 * behavior src/lib/scheduler/providers/bullmq-provider.ts already relies on).
 * Call this once from the app's real process bootstrap to activate the 6
 * recurring jobs — not wired in automatically by this file (see the
 * top-of-file comment).
 */
export async function registerRecurringBillingJobs(): Promise<void> {
  ensureWorker();
  const queue = getQueue();
  for (const { job, cronExpression } of JOB_SCHEDULES) {
    await queue.upsertJobScheduler(
      `billing-${job}`,
      { pattern: cronExpression },
      { name: job, data: { job }, opts: { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } },
    );
  }
}

export interface RecurringBillingQueueStats {
  active: number;
  waiting: number;
  delayed: number;
  completed: number;
  failed: number;
}

/** Real job counts straight from BullMQ/Redis for this queue. */
export async function getRecurringBillingQueueStats(): Promise<RecurringBillingQueueStats> {
  const counts = await getQueue().getJobCounts("active", "waiting", "delayed", "completed", "failed");
  return {
    active: counts.active ?? 0,
    waiting: counts.waiting ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
  };
}

export interface FailedRecurringBillingJobRecord {
  id: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
}

/** Real failed jobs from this queue's BullMQ failed set — this queue's own Dead Letter Queue view. */
export async function listFailedRecurringBillingJobs(limit = 50): Promise<FailedRecurringBillingJobRecord[]> {
  const jobs = await getQueue().getJobs(["failed"], 0, limit);
  return jobs.map((job) => ({
    id: job.id ?? "",
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  }));
}
