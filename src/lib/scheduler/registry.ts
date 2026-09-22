import { prisma } from "@/lib/prisma";
import { ensureTodaySnapshot } from "@/lib/analytics";
import { ensureTodayProjectHealthSnapshot } from "@/lib/projects/health-score";
import { ensureTodayClientHealthSnapshot } from "@/lib/clients/health-score";
import { ensureTodayGrowthScoreSnapshot } from "@/lib/growth/score";
import { generateGrowthImprovementPlan } from "@/lib/growth/improvement-plan";
import { ensureLatestChurnRiskAssessment } from "@/lib/clients/churn";
import { runPredictionCalibrationForOrg } from "@/lib/ai/prediction-calibration";
import { runLearningEngineJob } from "@/lib/learning/job";
import { runForecastEngineJob } from "@/lib/forecast/job";
import { generateClientOpportunities } from "@/lib/clients/opportunity-engine";
import { refreshCompetitorSnapshot } from "@/lib/company-discovery/competitor-discovery";
import { discoverMarketTrends } from "@/lib/market-intelligence/trend-discovery";
import { generateExecutiveInsights } from "@/lib/ai/insights-generator";
import { generateDailyBrief } from "@/lib/ai/executive-briefing";
import { startSystemTriggeredExecutiveMeeting } from "@/lib/ai/meeting-lifecycle";
import { startDeliveryBoardMeeting, runDeliveryBoardRound } from "@/lib/ai/delivery-board-orchestrator";
import { advanceSequenceCore } from "@/app/dashboard/outreach/_lib/sequence-actions";
import { fireOverdueIfApplicable } from "@/app/dashboard/crm/_lib/task-actions";
import { fireOverdueIfApplicable as fireInvoiceOverdueIfApplicable } from "@/app/dashboard/proposal/_lib/invoice-actions";
import { isAIConnected } from "@/lib/ai/client";
import { notifyUser, notifyOrganizationOwners } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { runEmailHealthCheck } from "@/lib/outreach/email-health-job";
import { runAndRecordFullSystemCheck } from "@/lib/monitoring/aggregate";
import { runLeadDiscoveryForAllOrganizations } from "@/lib/business-development/discovery-job";
import { runKvlCountryOutreach, runKvlDailyCatchup, sendKvlDailyReport } from "@/lib/business-development/kvl-sector-discovery-job";
import { runKvlReplySync } from "@/lib/business-development/kvl-reply-sync-job";
import { runCompanyResearchBacklog } from "@/lib/business-development/company-research-job";
import { runWebsiteIntelligenceSync } from "@/lib/business-development/website-intelligence-sync-job";
import { runDecisionMakerSync } from "@/lib/business-development/decision-maker-sync-job";
import { runStaleCompanyReenrichment } from "@/lib/business-development/stale-reenrichment-job";
import { runPartnerDiscoverySync } from "@/lib/business-development/partner-discovery-sync-job";
import { runRevenueAttributionRecompute } from "@/lib/analytics/revenue-attribution-job";
import { runScheduledEmailSend } from "@/lib/business-development/scheduled-send-job";
import { runScheduledCareerJobDiscovery } from "@/lib/career/career-discovery-job";
import { runAutonomousApplicationSubmission, runSubmissionStatusReconciliation } from "@/lib/career/career-application-job";
import { runFollowUpScheduling, runFollowUpSending } from "@/lib/career/career-followup-job";
import { persistJobMarketSnapshot } from "@/lib/career/market-intelligence";
import { runBackupScript } from "@/lib/ops/run-backup-script";
import { runRestoreTest } from "@/lib/ops/restore-test";
import type { JobDefinition, JobRunLog } from "./types";

const DELIVERY_ROUNDS_PER_MEETING = 2;
const AUDIT_LOG_RETENTION_DAYS = 400;
// A byproduct of scheduling executive-insights-refresh daily (previously
// manual-refresh-only, ~7 rows/org/run): without pruning, Insight rows
// accumulate forever. 90 days keeps a real trend history without unbounded growth.
const INSIGHT_RETENTION_DAYS = 90;
// Judgment call: LinkedIn sending is manual by design (the user pastes the
// message themselves), so a draft sitting APPROVED/QUEUED isn't a bug — but
// 2 days idle is long enough that it's likely forgotten, not just "later
// today." Short enough to still be a useful nudge on an outreach cadence.
const LINKEDIN_REMINDER_THRESHOLD_DAYS = 2;
// Judgment call: a proposal sitting SENT with zero response for 5 days is
// long enough that the owner has likely moved on to other work and forgotten
// to chase it, but short enough that the nudge still lands while following
// up is natural rather than awkward.
const PROPOSAL_FOLLOWUP_THRESHOLD_DAYS = 5;
// Judgment call: 3 days catches an invoice both while it's still "due soon"
// (a useful heads-up before the due date) and right after it's "just gone
// overdue" (still fresh enough that a nudge reads as helpful, not nagging).
const INVOICE_DUE_REMINDER_WINDOW_DAYS = 3;
// SecurityEvent is security TELEMETRY, not an audit-of-record the way
// AuditLog is (400 days) — a shorter window is defensible. See
// securityEventRetentionCleanupJob's own doc comment for how this cutoff is
// clamped against any currently-open Incident so pruning can never remove a
// row from the time window of an active investigation.
const SECURITY_EVENT_RETENTION_DAYS = 180;
// A DeviceSession with no activity in 180+ days is an abandoned/expired
// session, not meaningful security history worth keeping indefinitely.
// Scoped strictly by lastActiveAt (not createdAt), so a session that's old
// but still genuinely in use (lastActiveAt keeps refreshing) is never
// touched.
const DEVICE_SESSION_INACTIVE_RETENTION_DAYS = 180;
// Only prunes Restore rows where isTest is true (weekly-restore-test's own
// output — see restoreTestRetentionCleanupJob's doc comment for why real
// Backup rows/files are deliberately NOT pruned here). 90 days keeps ~13
// weeks of restore-test history without unbounded growth.
const RESTORE_TEST_RETENTION_DAYS = 90;

/**
 * Every job below delegates to a real, already-shipped (or newly-added)
 * business function — nothing here is a no-op or a placeholder that merely
 * pretends to do work. Jobs named in the original brief whose underlying
 * feature doesn't exist YET (AI memory consolidation, knowledge-base
 * indexing, cache cleanup) are intentionally NOT registered here — each is
 * added in the batch that builds its underlying feature, rather than
 * faking a job that would run and do nothing. Phase 17 (Autonomous AI
 * Business Development System) added: `lead-discovery` and
 * `company-research-backlog` — both per-org opt-in via
 * `LeadDiscoveryConfig.discoveryEnabled`, since they create real CRM data
 * and spend real AI credits unattended.
 */

async function dailyMetricSnapshotJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  for (const org of orgs) {
    try {
      await ensureTodaySnapshot(org.id);
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Snapshotted ${orgs.length} organization(s).` });
  return logs;
}

async function dailyProjectHealthSnapshotJob(): Promise<JobRunLog[]> {
  const projects = await prisma.project.findMany({
    where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } },
    select: { id: true, organizationId: true },
  });
  const logs: JobRunLog[] = [];
  for (const project of projects) {
    try {
      await ensureTodayProjectHealthSnapshot(project.id, project.organizationId);
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: project.organizationId });
    }
  }
  logs.push({ level: "info", message: `Snapshotted health for ${projects.length} active project(s).` });
  return logs;
}

async function clientHealthSnapshotJob(): Promise<JobRunLog[]> {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true },
  });
  const logs: JobRunLog[] = [];
  for (const client of clients) {
    try {
      await ensureTodayClientHealthSnapshot(client.id, client.organizationId);
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: client.organizationId });
    }
  }
  logs.push({ level: "info", message: `Snapshotted health for ${clients.length} active client(s).` });
  return logs;
}

async function growthScoreSnapshotJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  for (const org of orgs) {
    try {
      await ensureTodayGrowthScoreSnapshot(org.id);
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Snapshotted Growth Score for ${orgs.length} organization(s).` });
  return logs;
}

async function growthImprovementPlanRefreshJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured." }];
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let generated = 0;
  for (const org of orgs) {
    try {
      const snapshot = await prisma.growthScoreSnapshot.findFirst({ where: { organizationId: org.id } });
      if (!snapshot) continue; // nothing to ground a plan in yet — skip honestly rather than generating from nothing
      await generateGrowthImprovementPlan(org.id);
      generated += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Generated ${generated} growth improvement plan(s).` });
  return logs;
}

async function clientChurnAssessmentJob(): Promise<JobRunLog[]> {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true },
  });
  const logs: JobRunLog[] = [];
  for (const client of clients) {
    try {
      await ensureLatestChurnRiskAssessment(client.id, client.organizationId);
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: client.organizationId });
    }
  }
  logs.push({ level: "info", message: `Assessed churn risk for ${clients.length} active client(s).` });
  return logs;
}

/**
 * Real, closed self-improvement loop (src/lib/ai/prediction-calibration.ts)
 * — compares past AI-estimated Proposal Review Board win probabilities
 * against real terminal Proposal outcomes, persists a calibration snapshot,
 * and feeds the latest one back into the next review round. Pure Prisma
 * aggregation, zero AI spend — the cheapest of the nightly jobs.
 */
async function predictionCalibrationJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let persisted = 0;
  for (const org of orgs) {
    try {
      const result = await runPredictionCalibrationForOrg(org.id);
      if (result.persisted) persisted += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Computed prediction calibration for ${persisted} of ${orgs.length} organization(s) (rest had too few terminal proposals).` });
  return logs;
}

const CLIENT_OPPORTUNITY_SCAN_MAX_PER_ORG = 5;

async function clientOpportunityScanJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured (deterministic upsell/cross-sell still needs a client batch, so the whole scan waits for AI so referral candidacy isn't silently incomplete)." }];

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let totalGenerated = 0;

  for (const org of orgs) {
    // Oldest-scanned-first via absence of any prior ClientOpportunity row —
    // bounded batch per run (real AI spend for the referral step), same
    // pattern as company-research-backlog.
    const clients = await prisma.client.findMany({
      where: { organizationId: org.id, status: "ACTIVE", opportunities: { none: {} } },
      orderBy: { createdAt: "asc" },
      take: CLIENT_OPPORTUNITY_SCAN_MAX_PER_ORG,
      select: { id: true },
    });
    for (const client of clients) {
      try {
        const created = await generateClientOpportunities(client.id, org.id);
        totalGenerated += created.length;
      } catch (error) {
        logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
      }
    }
  }
  logs.push({ level: "info", message: `Generated ${totalGenerated} client opportunit(y/ies) across all organizations.` });
  return logs;
}

async function competitorIntelligenceRefreshJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured." }];

  const orgs = await prisma.organizationDNA.findMany({
    where: { status: "APPROVED" },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  const logs: JobRunLog[] = [];
  let refreshed = 0;
  for (const { organizationId } of orgs) {
    try {
      await refreshCompetitorSnapshot(organizationId);
      refreshed += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId });
    }
  }
  logs.push({ level: "info", message: `Refreshed competitor intelligence for ${refreshed} organization(s).` });
  return logs;
}

async function marketTrendRefreshJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured." }];

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let refreshed = 0;
  for (const org of orgs) {
    try {
      await discoverMarketTrends(org.id);
      refreshed += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Refreshed market trend intelligence for ${refreshed} organization(s).` });
  return logs;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function executiveInsightsRefreshJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured." }];

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let generated = 0;
  const today = startOfToday();

  for (const org of orgs) {
    try {
      // Dedup guard: don't stomp a manual "Refresh insights" click that
      // already ran today via the Command Center button.
      const generatedToday = await prisma.insight.findFirst({ where: { organizationId: org.id, createdAt: { gte: today } } });
      if (generatedToday) continue;
      await generateExecutiveInsights(org.id);
      generated += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Generated Executive Insights for ${generated} organization(s).` });
  return logs;
}

async function insightRetentionCleanupJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INSIGHT_RETENTION_DAYS);
  const result = await prisma.insight.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return [{ level: "info", message: `Pruned ${result.count} Insight row(s) older than ${INSIGHT_RETENTION_DAYS} days.` }];
}

async function dailyCeoBriefJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  let generated = 0;
  for (const org of orgs) {
    try {
      await generateDailyBrief(org.id);
      await notifyOrganizationOwners({
        organizationId: org.id,
        type: "DAILY_BRIEF_READY",
        title: "Your daily brief is ready",
        message: "The AI CEO Daily Brief has been generated with today's real business data.",
      });
      generated += 1;
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  logs.push({ level: "info", message: `Generated the daily CEO brief for ${generated} organization(s).` });
  return logs;
}

// Phase 20 (Disaster Recovery): the real backup mechanism (scripts/backup-
// database.sh, scripts/backup-storage.sh, src/lib/ops/run-backup-script.ts)
// already existed but was never actually scheduled — these three jobs are
// what finally wires it into automated cadence. Every run writes a real
// Backup/Restore row (Production Dashboard) regardless of outcome; a
// failure is reported honestly, never silently retried into a fabricated
// success.

async function nightlyDatabaseBackupJob(): Promise<JobRunLog[]> {
  const backup = await runBackupScript("DATABASE");
  if (backup.status === "SUCCEEDED") {
    return [{ level: "info", message: `Database backup ${backup.id} succeeded (${backup.sizeBytes ?? 0} bytes).` }];
  }
  return [{ level: "error", message: `Database backup ${backup.id} failed: ${backup.error ?? "unknown error"}` }];
}

async function weeklyStorageBackupJob(): Promise<JobRunLog[]> {
  const backup = await runBackupScript("STORAGE");
  if (backup.status === "SUCCEEDED") {
    return [{ level: "info", message: `Storage backup ${backup.id} succeeded (${backup.sizeBytes ?? 0} bytes).` }];
  }
  return [{ level: "error", message: `Storage backup ${backup.id} failed: ${backup.error ?? "unknown error"}` }];
}

async function weeklyRestoreTestJob(): Promise<JobRunLog[]> {
  const latestBackup = await prisma.backup.findFirst({ where: { type: "DATABASE", status: "SUCCEEDED" }, orderBy: { completedAt: "desc" } });
  if (!latestBackup) return [{ level: "warn", message: "Skipped — no SUCCEEDED DATABASE backup exists yet to restore-test." }];

  const restore = await runRestoreTest(latestBackup.id);
  if (restore.status === "SUCCEEDED") {
    return [{ level: "info", message: `Restore test ${restore.id} succeeded against backup ${latestBackup.id}.` }];
  }
  return [{ level: "error", message: `Restore test ${restore.id} failed against backup ${latestBackup.id}: ${restore.error ?? "unknown error"}` }];
}

async function dailyExecutiveBoardMeetingJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — ANTHROPIC_API_KEY not configured." }];
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  for (const org of orgs) {
    try {
      const result = await startSystemTriggeredExecutiveMeeting(org.id);
      logs.push(
        "meetingId" in result && result.meetingId
          ? { level: "info", message: `Started meeting ${result.meetingId}.`, organizationId: org.id }
          : { level: "info", message: `Skipped: ${result.skippedReason}.`, organizationId: org.id },
      );
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  return logs;
}

async function dailyDeliveryBoardMeetingJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — ANTHROPIC_API_KEY not configured." }];
  const projects = await prisma.project.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true, ownerUserId: true },
  });
  const logs: JobRunLog[] = [];

  for (const project of projects) {
    try {
      const alreadyToday = await prisma.meeting.findFirst({
        where: {
          relatedProjectId: project.id,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        select: { id: true },
      });
      if (alreadyToday) {
        logs.push({ level: "info", message: `Skipped project ${project.id}: already ran today.`, organizationId: project.organizationId });
        continue;
      }

      let userId = project.ownerUserId;
      if (!userId) {
        const owner = await prisma.membership.findFirst({
          where: { organizationId: project.organizationId, status: "ACTIVE", role: "OWNER" },
          orderBy: { createdAt: "asc" },
          select: { userId: true },
        });
        userId = owner?.userId ?? null;
      }
      if (!userId) {
        logs.push({ level: "warn", message: `Skipped project ${project.id}: no owner user to act as convener.`, organizationId: project.organizationId });
        continue;
      }

      const { meetingId } = await startDeliveryBoardMeeting(project.id, userId);
      for (let round = 0; round < DELIVERY_ROUNDS_PER_MEETING; round += 1) {
        await runDeliveryBoardRound(meetingId);
      }
      logs.push({ level: "info", message: `Started delivery meeting ${meetingId} for project ${project.id}.`, organizationId: project.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: project.organizationId });
    }
  }
  return logs;
}

/**
 * Runs the same idempotent "has enough time passed since the last SENT
 * draft" check that advanceSequence performs on page view — this job adds
 * no new business logic, it's just what makes that check fire on a regular
 * cron tick instead of only when a user happens to visit the outreach page.
 * "Active in a sequence" is derived from EmailDraft rows (there is no
 * separate enrollment/status model): every distinct (contactId, sequenceId)
 * pair with at least one draft is a candidate, and advanceSequenceCore's own
 * idempotency guard (already complete / not yet due) makes it safe to call
 * on pairs that aren't actually due this run.
 */
async function sequenceAdvancementJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];

  for (const org of orgs) {
    const pairs = await prisma.emailDraft.groupBy({
      by: ["contactId", "sequenceId"],
      where: { organizationId: org.id, sequenceId: { not: null } },
    });

    for (const pair of pairs) {
      if (!pair.sequenceId) continue;
      try {
        const result = await advanceSequenceCore(pair.contactId, pair.sequenceId, org.id);
        if (!result.ok) {
          logs.push({ level: "error", message: `Contact ${pair.contactId} / sequence ${pair.sequenceId}: ${result.error}`, organizationId: org.id });
        } else if (result.advanced) {
          logs.push({
            level: "info",
            message: `Advanced contact ${pair.contactId} in sequence ${pair.sequenceId} to step ${result.draft?.sequenceStepIndex}.`,
            organizationId: org.id,
          });
        } else if (result.complete) {
          logs.push({ level: "info", message: `Contact ${pair.contactId} / sequence ${pair.sequenceId}: sequence complete.`, organizationId: org.id });
        } else {
          logs.push({ level: "info", message: `Contact ${pair.contactId} / sequence ${pair.sequenceId}: not due yet.`, organizationId: org.id });
        }
      } catch (error) {
        logs.push({
          level: "error",
          message: `Contact ${pair.contactId} / sequence ${pair.sequenceId}: ${error instanceof Error ? error.message : String(error)}`,
          organizationId: org.id,
        });
      }
    }
  }

  return logs;
}

/**
 * LinkedIn sending is manual by design — this app never automates LinkedIn,
 * the user pastes the message themselves and confirms via
 * markLinkedInDraftSent (src/app/dashboard/outreach/_lib/approval-actions.ts).
 * A LINKEDIN draft sits APPROVED or QUEUED (both are "ready, waiting on the
 * human") until that confirmation. This job nudges whoever should send it —
 * the contact's assigned owner, falling back to the org's OWNER the same way
 * dailyDeliveryBoardMeetingJob does — once the draft has been ready for
 * longer than LINKEDIN_REMINDER_THRESHOLD_DAYS, and only once per draft
 * (reminderSentAt) so it doesn't spam on every daily tick.
 */
async function linkedInReminderJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LINKEDIN_REMINDER_THRESHOLD_DAYS);

  const drafts = await prisma.emailDraft.findMany({
    where: {
      channel: "LINKEDIN",
      reminderSentAt: null,
      OR: [
        { status: "APPROVED", approvedAt: { lt: cutoff } },
        { status: "QUEUED", queuedAt: { lt: cutoff } },
      ],
    },
    include: { contact: { include: { company: true } } },
  });

  const logs: JobRunLog[] = [];

  for (const draft of drafts) {
    try {
      const readySince = draft.status === "QUEUED" ? draft.queuedAt : draft.approvedAt;
      const daysReady = readySince
        ? Math.floor((Date.now() - readySince.getTime()) / (1000 * 60 * 60 * 24))
        : LINKEDIN_REMINDER_THRESHOLD_DAYS;

      let userId = draft.contact.ownerUserId;
      if (!userId) {
        const owner = await prisma.membership.findFirst({
          where: { organizationId: draft.organizationId, status: "ACTIVE", role: "OWNER" },
          orderBy: { createdAt: "asc" },
          select: { userId: true },
        });
        userId = owner?.userId ?? null;
      }
      if (!userId) {
        logs.push({ level: "warn", message: `Skipped draft ${draft.id}: no owner user to remind.`, organizationId: draft.organizationId });
        continue;
      }

      const contactLabel = `${draft.contact.firstName}${draft.contact.company?.name ? ` at ${draft.contact.company.name}` : ""}`;
      const message = `Your LinkedIn message to ${contactLabel} has been ready for ${daysReady} day(s) — don't forget to send it and confirm.`;

      await notifyUser({
        userId,
        organizationId: draft.organizationId,
        type: "EMAIL_READY",
        title: "LinkedIn message ready to send",
        message,
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, preference: { select: { emailNotifications: true } } },
      });
      if (user?.email && (user.preference?.emailNotifications ?? true)) {
        await sendEmail({
          to: user.email,
          subject: "LinkedIn message ready to send",
          text: message,
        });
      }

      await prisma.emailDraft.update({ where: { id: draft.id }, data: { reminderSentAt: new Date() } });
      logs.push({ level: "info", message: `Reminded ${userId} about draft ${draft.id} (${daysReady} day(s) ready).`, organizationId: draft.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: draft.organizationId });
    }
  }

  return logs;
}

async function auditLogRetentionCleanupJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AUDIT_LOG_RETENTION_DAYS);
  const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return [{ level: "info", message: `Pruned ${result.count} audit log row(s) older than ${AUDIT_LOG_RETENTION_DAYS} days.` }];
}

/**
 * SecurityEvent retention. Unlike AuditLog, a CRITICAL-severity SecurityEvent
 * can trigger ensureIncidentForCriticalEvent (src/lib/security/incidents.ts),
 * which opens or appends to an Incident — but there is no FK from
 * SecurityEvent back to the Incident(s) it may have triggered (Incident
 * captures its own independent title/description/timeline at creation time,
 * it doesn't reference the row that caused it), so this job cannot ask "is
 * this exact row linked to a still-open incident?" via a real join.
 *
 * The safe, conservative behavior instead: never delete any SecurityEvent
 * row created on/after the `startedAt` of the OLDEST currently-open
 * (non-RESOLVED) Incident. The effective cutoff is whichever is EARLIER —
 * the normal SECURITY_EVENT_RETENTION_DAYS-day age cutoff, or that
 * incident's start — so the entire time window during which any incident
 * has been under active investigation is preserved regardless of age, even
 * if that means retaining rows longer than the normal window.
 */
async function securityEventRetentionCleanupJob(): Promise<JobRunLog[]> {
  const ageCutoff = new Date();
  ageCutoff.setDate(ageCutoff.getDate() - SECURITY_EVENT_RETENTION_DAYS);

  const oldestOpenIncident = await prisma.incident.findFirst({
    where: { status: { not: "RESOLVED" } },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true },
  });

  const cutoff = oldestOpenIncident && oldestOpenIncident.startedAt < ageCutoff ? oldestOpenIncident.startedAt : ageCutoff;

  const result = await prisma.securityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return [
    {
      level: "info",
      message: oldestOpenIncident
        ? `Pruned ${result.count} SecurityEvent row(s) older than ${cutoff.toISOString()} (clamped to the oldest still-open Incident's start).`
        : `Pruned ${result.count} SecurityEvent row(s) older than ${SECURITY_EVENT_RETENTION_DAYS} days.`,
    },
  ];
}

/**
 * DeviceSession rows with no activity in DEVICE_SESSION_INACTIVE_RETENTION_
 * DAYS+ days are abandoned/expired sessions, not meaningful security
 * history. Scoped by `lastActiveAt` (refreshed on real activity), never by
 * `createdAt` — an old session that's still genuinely in use is never
 * touched.
 */
async function deviceSessionRetentionCleanupJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEVICE_SESSION_INACTIVE_RETENTION_DAYS);
  const result = await prisma.deviceSession.deleteMany({ where: { lastActiveAt: { lt: cutoff } } });
  return [{ level: "info", message: `Pruned ${result.count} DeviceSession row(s) inactive for more than ${DEVICE_SESSION_INACTIVE_RETENTION_DAYS} days.` }];
}

/**
 * Backup metadata rows — and the real backup FILES they point at via
 * Backup.storageKey (a real relative path under storage/backups/, written
 * by scripts/backup-database.sh / backup-storage.sh and recorded by
 * runBackupScript in src/lib/ops/run-backup-script.ts) — are deliberately
 * NOT pruned by any automated job. An unattended job with a scoping bug
 * (or a retention window set too aggressively) could silently delete
 * unrecoverable disaster-recovery backups, defeating the entire point of
 * having them. That gap is intentional and documented (see
 * checkDataRetentionPolicy in src/lib/security/compliance.ts) — real backup
 * file/row pruning is left as a human-supervised manual/future step, not
 * something this job takes on.
 *
 * What IS safe to prune automatically: Restore rows where `isTest` is true
 * — the pure verification records the weekly-restore-test job
 * (src/lib/ops/restore-test.ts) produces every run. These carry no unique
 * data of their own (the Backup row/file they tested is untouched by this
 * job), and a real production restore (`isTest: false`) never matches this
 * filter, so genuine disaster-recovery history is never pruned.
 */
async function restoreTestRetentionCleanupJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RESTORE_TEST_RETENTION_DAYS);
  const result = await prisma.restore.deleteMany({ where: { isTest: true, startedAt: { lt: cutoff } } });
  return [{ level: "info", message: `Pruned ${result.count} restore-test Restore row(s) older than ${RESTORE_TEST_RETENTION_DAYS} days.` }];
}

/**
 * Real-time fix for the CRM audit's flagged gap: overdue-task detection was
 * previously "evaluated-on-write/on-view rather than true real-time" (see
 * task-actions.ts's fireOverdueIfApplicable). This job calls that exact same
 * function — same dedup guard (overdueNotifiedAt), same TASK_OVERDUE
 * automation trigger — for every task that's overdue right now across every
 * organization, so detection no longer depends on someone opening the task.
 */
async function overdueTaskDetectionJob(): Promise<JobRunLog[]> {
  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { lt: new Date() },
      overdueNotifiedAt: null,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: { id: true, organizationId: true, title: true, dueDate: true, status: true, overdueNotifiedAt: true },
  });

  const logs: JobRunLog[] = [];
  for (const task of tasks) {
    try {
      await fireOverdueIfApplicable(task.organizationId, task);
      logs.push({ level: "info", message: `Flagged overdue task "${task.title}".`, organizationId: task.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: task.organizationId });
    }
  }
  return logs;
}

/**
 * A proposal sitting in SENT status with no ACCEPTED/REJECTED response is
 * easy to lose track of once the owner moves on to other work — this job
 * nudges the creator (falling back to the org's OWNER, same pattern as
 * dailyDeliveryBoardMeetingJob/linkedInReminderJob) once it's been sent for
 * longer than PROPOSAL_FOLLOWUP_THRESHOLD_DAYS, and only once per proposal
 * (reminderSentAt) so it doesn't re-notify on every tick.
 */
async function proposalFollowUpReminderJob(): Promise<JobRunLog[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PROPOSAL_FOLLOWUP_THRESHOLD_DAYS);

  const proposals = await prisma.proposal.findMany({
    where: {
      status: "SENT",
      reminderSentAt: null,
      sentAt: { lt: cutoff },
    },
    select: { id: true, organizationId: true, title: true, sentAt: true, createdByUserId: true },
  });

  const logs: JobRunLog[] = [];

  for (const proposal of proposals) {
    try {
      const daysSince = proposal.sentAt
        ? Math.floor((Date.now() - proposal.sentAt.getTime()) / (1000 * 60 * 60 * 24))
        : PROPOSAL_FOLLOWUP_THRESHOLD_DAYS;

      let userId = proposal.createdByUserId;
      if (!userId) {
        const owner = await prisma.membership.findFirst({
          where: { organizationId: proposal.organizationId, status: "ACTIVE", role: "OWNER" },
          orderBy: { createdAt: "asc" },
          select: { userId: true },
        });
        userId = owner?.userId ?? null;
      }
      if (!userId) {
        logs.push({ level: "warn", message: `Skipped proposal ${proposal.id}: no owner user to remind.`, organizationId: proposal.organizationId });
        continue;
      }

      const message = `Your proposal "${proposal.title}" was sent ${daysSince} day(s) ago with no response yet — consider following up.`;

      await notifyUser({
        userId,
        organizationId: proposal.organizationId,
        type: "PROPOSAL_SENT",
        title: "Proposal follow-up reminder",
        message,
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, preference: { select: { emailNotifications: true } } },
      });
      if (user?.email && (user.preference?.emailNotifications ?? true)) {
        await sendEmail({
          to: user.email,
          subject: "Proposal follow-up reminder",
          text: message,
        });
      }

      await prisma.proposal.update({ where: { id: proposal.id }, data: { reminderSentAt: new Date() } });
      logs.push({ level: "info", message: `Reminded ${userId} to follow up on proposal ${proposal.id} (${daysSince} day(s) since sent).`, organizationId: proposal.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: proposal.organizationId });
    }
  }

  return logs;
}

/**
 * Two real, distinct effects, logged separately:
 *
 * 1. Status transition — reuses invoice-actions.ts's fireOverdueIfApplicable
 *    (now exported) on every genuinely-unpaid SENT invoice past its due
 *    date, instead of duplicating that update here. That function already
 *    exists and is documented as firing "on write" only (same limitation as
 *    CRM Task's TASK_OVERDUE); this job gives it the same real-time cadence
 *    overdueTaskDetectionJob already gives the task version, so an invoice
 *    no one happens to touch still flips to OVERDUE on schedule rather than
 *    staying SENT forever.
 * 2. Reminder — nudges whoever should chase payment (the invoice's creator,
 *    falling back to the org's OWNER membership) once per invoice
 *    (reminderSentAt dedup) while it's within
 *    INVOICE_DUE_REMINDER_WINDOW_DAYS of its due date, either side.
 */
async function invoiceDueReminderJob(): Promise<JobRunLog[]> {
  const logs: JobRunLog[] = [];
  const now = new Date();

  const pastDueSent = await prisma.invoice.findMany({
    where: { status: "SENT", dueDate: { lt: now } },
    select: { id: true, organizationId: true, invoiceNumber: true, dueDate: true, status: true, grandTotal: true, amountPaid: true },
  });

  for (const invoice of pastDueSent) {
    if (invoice.amountPaid >= invoice.grandTotal) continue;
    try {
      await fireInvoiceOverdueIfApplicable(invoice.organizationId, invoice);
      logs.push({ level: "info", message: `Transitioned invoice ${invoice.invoiceNumber} to OVERDUE.`, organizationId: invoice.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: invoice.organizationId });
    }
  }

  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - INVOICE_DUE_REMINDER_WINDOW_DAYS);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + INVOICE_DUE_REMINDER_WINDOW_DAYS);

  const dueSoonOrOverdue = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "OVERDUE"] },
      reminderSentAt: null,
      dueDate: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, organizationId: true, invoiceNumber: true, dueDate: true, status: true, grandTotal: true, amountPaid: true, createdByUserId: true },
  });

  for (const invoice of dueSoonOrOverdue) {
    if (invoice.amountPaid >= invoice.grandTotal || !invoice.dueDate) continue;
    try {
      let userId = invoice.createdByUserId;
      if (!userId) {
        const owner = await prisma.membership.findFirst({
          where: { organizationId: invoice.organizationId, status: "ACTIVE", role: "OWNER" },
          orderBy: { createdAt: "asc" },
          select: { userId: true },
        });
        userId = owner?.userId ?? null;
      }
      if (!userId) {
        logs.push({ level: "warn", message: `Skipped invoice ${invoice.invoiceNumber}: no owner user to remind.`, organizationId: invoice.organizationId });
        continue;
      }

      const remaining = invoice.grandTotal - invoice.amountPaid;
      const dueDateLabel = invoice.dueDate.toISOString().slice(0, 10);
      const message = `Invoice ${invoice.invoiceNumber} for ${remaining.toFixed(2)} is ${invoice.status === "OVERDUE" ? "overdue" : "due soon"} (due ${dueDateLabel}).`;

      await notifyUser({
        userId,
        organizationId: invoice.organizationId,
        type: "DEADLINE_APPROACHING",
        title: invoice.status === "OVERDUE" ? "Invoice overdue" : "Invoice due soon",
        message,
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, preference: { select: { emailNotifications: true } } },
      });
      if (user?.email && (user.preference?.emailNotifications ?? true)) {
        await sendEmail({
          to: user.email,
          subject: invoice.status === "OVERDUE" ? "Invoice overdue" : "Invoice due soon",
          text: message,
        });
      }

      await prisma.invoice.update({ where: { id: invoice.id }, data: { reminderSentAt: new Date() } });
      logs.push({ level: "info", message: `Reminded ${userId} about invoice ${invoice.invoiceNumber} (${invoice.status === "OVERDUE" ? "overdue" : "due soon"}).`, organizationId: invoice.organizationId });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: invoice.organizationId });
    }
  }

  return logs;
}

/**
 * Real Smart Alerts rule engine (src/lib/alerts/rules.ts + engine.ts) run
 * hourly for every organization — the production-grade cron path, not a
 * lazy-only "only evaluates when someone opens the Alert Center" shortcut.
 * evaluateAlerts already never throws its per-rule failures out to the
 * caller in a way that stops other orgs; this job's try/catch exists purely
 * to keep one organization's DB error from stopping the loop over the rest.
 */
async function smartAlertsEvaluationJob(): Promise<JobRunLog[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const logs: JobRunLog[] = [];
  for (const org of orgs) {
    try {
      await evaluateAlerts(org.id);
      logs.push({ level: "info", message: `Evaluated Smart Alerts.`, organizationId: org.id });
    } catch (error) {
      logs.push({ level: "error", message: error instanceof Error ? error.message : String(error), organizationId: org.id });
    }
  }
  return logs;
}

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — see
 * email-health-job.ts's doc comment for why this exists as its own job
 * (tighter cadence than the hourly Smart Alerts cycle for the safety-
 * critical circuit breaker) rather than piggybacking entirely on
 * smartAlertsEvaluationJob above.
 */
async function emailHealthCheckJob(): Promise<JobRunLog[]> {
  return runEmailHealthCheck();
}

/**
 * Periodic infra health snapshot — runs the exact same real check/persist/
 * alert pipeline as the public GET /api/health route (src/lib/monitoring/
 * aggregate.ts's runAndRecordFullSystemCheck), so SystemHealthSnapshot rows
 * (and SystemAlert reconciliation) keep accruing on a real cadence even
 * during a stretch with no external traffic hitting /api/health at all.
 */
async function healthSnapshotJob(): Promise<JobRunLog[]> {
  const result = await runAndRecordFullSystemCheck();
  return [
    {
      level: result.overall === "DOWN" ? "error" : result.overall === "DEGRADED" ? "warn" : "info",
      message: `Overall: ${result.overall}. ${result.components.map((c) => `${c.component}=${c.status}`).join(", ")}`,
    },
  ];
}

async function leadDiscoveryJob(): Promise<JobRunLog[]> {
  if (!isAIConnected()) return [{ level: "warn", message: "Skipped — no AI provider configured." }];
  const summaries = await runLeadDiscoveryForAllOrganizations();
  return summaries.map((s) =>
    s.skippedReason
      ? { level: "info", message: `Skipped: ${s.skippedReason}.`, organizationId: s.organizationId }
      : {
          level: "info",
          message: `${s.queriesRun} quer${s.queriesRun === 1 ? "y" : "ies"} run, ${s.companiesFound} new lead${s.companiesFound === 1 ? "" : "s"} found, ${s.duplicatesSkipped} duplicate${s.duplicatesSkipped === 1 ? "" : "s"} skipped.`,
          organizationId: s.organizationId,
        },
  );
}

function kvlCountryOutreachJob(groupKey: string): () => Promise<JobRunLog[]> {
  return () => runKvlCountryOutreach(groupKey);
}

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real, opt-in-only
 * career job discovery. Delegates entirely to runScheduledCareerJobDiscovery
 * (career-discovery-job.ts), which itself only touches CareerProfile rows
 * with discoveryEnabled: true — no unattended discovery for a profile that
 * hasn't opted in, same discipline as leadDiscoveryJob above.
 */
async function careerJobDiscoveryJob(): Promise<JobRunLog[]> {
  const summaries = await runScheduledCareerJobDiscovery();
  if (summaries.length === 0) return [{ level: "info", message: "No career profiles have discovery enabled." }];
  return summaries.map((s) =>
    s.skipped
      ? { level: "info", message: `Profile ${s.careerProfileId}: skipped — ${s.skipped}`, organizationId: s.organizationId }
      : {
          level: s.ok ? "info" : "warn",
          message: s.ok ? `Profile ${s.careerProfileId}: ${s.newJobsCount ?? 0} new job(s) found.` : `Profile ${s.careerProfileId}: ${s.error}`,
          organizationId: s.organizationId,
        },
  );
}

/**
 * Phase 20 (Autonomous AI Job Application Agent) — real, opt-in-only
 * autonomous submission (§21-23/§53). See career-application-job.ts's doc
 * comment — a missed run just means tomorrow's run (or the user's own
 * approve/submit action) covers it; nothing here is time-critical enough
 * to warrant an automatic retry that could risk a double-run race.
 */
async function autonomousApplicationSubmissionJob(): Promise<JobRunLog[]> {
  const summaries = await runAutonomousApplicationSubmission();
  if (summaries.length === 0) return [{ level: "info", message: "No applications eligible for autonomous submission." }];
  return summaries.map((s) => ({
    level: s.error ? "warn" : "info",
    message: s.error ? `Application ${s.applicationId}: ${s.error}` : `Application ${s.applicationId}: ${s.status}`,
    organizationId: s.organizationId,
  }));
}

/** Phase 20 — real, periodic re-check of any SUBMITTED/SUBMITTED_UNCONFIRMED application against its actual provider confirmation signal (§31/§39/§56). */
async function submissionStatusReconciliationJob(): Promise<JobRunLog[]> {
  const summaries = await runSubmissionStatusReconciliation();
  if (summaries.length === 0) return [{ level: "info", message: "No applications pending confirmation." }];
  return summaries.map((s) => ({
    level: s.error ? "warn" : "info",
    message: s.error ? `Application ${s.applicationId}: ${s.error}` : `Application ${s.applicationId}: ${s.status}`,
    organizationId: s.organizationId,
  }));
}

/** Phase 21 (§40/§57) — real, idempotent scheduling of configured follow-up touchpoints for newly-submitted applications. */
async function careerFollowUpSchedulingJob(): Promise<JobRunLog[]> {
  const summaries = await runFollowUpScheduling();
  const withCreated = summaries.filter((s) => s.created > 0 || s.error);
  if (withCreated.length === 0) return [{ level: "info", message: "No new follow-up rows to schedule." }];
  return withCreated.map((s) => ({
    level: s.error ? "warn" : "info",
    message: s.error ? `Application ${s.applicationId}: ${s.error}` : `Application ${s.applicationId}: scheduled ${s.created} follow-up(s).`,
    organizationId: s.organizationId,
  }));
}

/** Phase 21 (§41/§58) — real send, re-checking every stopping condition immediately before send, never relying on schedule-time state. */
async function careerFollowUpSendingJob(): Promise<JobRunLog[]> {
  const summaries = await runFollowUpSending();
  if (summaries.length === 0) return [{ level: "info", message: "No follow-ups due." }];
  return summaries.map((s) => ({
    level: s.status === "SKIPPED" ? "warn" : "info",
    message: `Follow-up ${s.followUpId}: ${s.status}${s.reason ? ` — ${s.reason}` : ""}.`,
    organizationId: s.organizationId,
  }));
}

/**
 * Phase 22 (§25/§51) — real, global job-market snapshot generation. Weekly
 * (not daily) deliberately: this codebase's only real job source
 * (Remotive) documents a real ~4-requests/day rate-limit guidance already
 * honored by Phase 19's own discovery cooldown (job-discovery.ts) — a
 * snapshot job doesn't need fresher-than-weekly granularity for a still-
 * small, slowly-growing Job catalog, and running it more often would only
 * generate near-identical snapshots.
 */
async function careerMarketSnapshotJob(): Promise<JobRunLog[]> {
  const result = await persistJobMarketSnapshot();
  return [{ level: "info", message: `Job market snapshot ${result.id}: ${result.sampleSize} real jobs sampled.` }];
}

async function kvlDailyCatchupJob(): Promise<JobRunLog[]> {
  return runKvlDailyCatchup();
}

async function kvlDailyReportJob(): Promise<JobRunLog[]> {
  return sendKvlDailyReport();
}

async function kvlReplySyncJob(): Promise<JobRunLog[]> {
  return runKvlReplySync();
}

async function companyResearchBacklogJob(): Promise<JobRunLog[]> {
  const summaries = await runCompanyResearchBacklog();
  const logs: JobRunLog[] = [];
  for (const s of summaries) {
    if (s.skippedReason) {
      logs.push({ level: "warn", message: `Skipped: ${s.skippedReason}.` });
      continue;
    }
    logs.push({
      level: "info",
      message: `${s.processed} companies researched, ${s.failed} failed, ${s.intentScoresComputed} intent score(s) computed, ${s.opportunityScoresComputed} opportunity score(s) computed.`,
      organizationId: s.organizationId,
    });
    for (const scoringError of s.scoringErrors) {
      logs.push({ level: "error", message: scoringError, organizationId: s.organizationId });
    }
  }
  return logs;
}

async function websiteIntelligenceSyncJob(): Promise<JobRunLog[]> {
  return runWebsiteIntelligenceSync();
}

async function decisionMakerSyncJob(): Promise<JobRunLog[]> {
  return runDecisionMakerSync();
}

async function staleCompanyReenrichmentJob(): Promise<JobRunLog[]> {
  return runStaleCompanyReenrichment();
}

async function partnerDiscoverySyncJob(): Promise<JobRunLog[]> {
  return runPartnerDiscoverySync();
}

async function scheduledEmailSendJob(): Promise<JobRunLog[]> {
  return runScheduledEmailSend();
}

async function revenueAttributionRecomputeJob(): Promise<JobRunLog[]> {
  return runRevenueAttributionRecompute();
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  {
    key: "daily-metric-snapshot",
    name: "Daily analytics snapshot",
    cronExpression: "15 0 * * *",
    handler: dailyMetricSnapshotJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 5, // pure background housekeeping — nothing user-facing blocks on it landing at a particular moment
  },
  {
    key: "daily-project-health-snapshot",
    name: "Daily project health snapshot",
    cronExpression: "30 0 * * *",
    handler: dailyProjectHealthSnapshotJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 5, // same as the analytics snapshot — a nightly derived rollup, not urgent
  },
  {
    key: "daily-executive-board-meeting",
    name: "Daily AI Executive Board meeting",
    cronExpression: "0 9 * * 1-5",
    handler: dailyExecutiveBoardMeetingJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 3, // user-visible AI output, but scheduled once a day with no tight downstream deadline
  },
  {
    key: "daily-delivery-board-meeting",
    name: "Daily AI Delivery Board meeting",
    cronExpression: "30 9 * * 1-5",
    handler: dailyDeliveryBoardMeetingJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 3, // same tier as the executive board meeting — daily AI cadence, not time-critical
  },
  {
    key: "audit-log-retention-cleanup",
    name: "Audit log retention cleanup",
    cronExpression: "0 2 * * 0",
    handler: auditLogRetentionCleanupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // weekly bulk deletion housekeeping — lowest priority, no user waits on it
  },
  {
    key: "security-event-retention-cleanup",
    name: "Security event retention cleanup",
    cronExpression: "0 4 * * 0",
    handler: securityEventRetentionCleanupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // weekly bulk deletion housekeeping, same tier as audit-log-retention-cleanup
  },
  {
    key: "device-session-retention-cleanup",
    name: "Inactive device session cleanup",
    cronExpression: "30 4 * * 0",
    handler: deviceSessionRetentionCleanupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // weekly bulk deletion housekeeping — lowest priority, no user waits on it
  },
  {
    key: "restore-test-retention-cleanup",
    name: "Restore-test metadata retention cleanup",
    cronExpression: "0 5 * * 0",
    handler: restoreTestRetentionCleanupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // weekly bulk deletion housekeeping — lowest priority, no user waits on it
  },
  {
    key: "scheduled-email-send",
    name: "Scheduled email send",
    cronExpression: "*/5 * * * *",
    handler: scheduledEmailSendJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 2, // a human set a real wall-clock send time via Compose's Schedule action — shouldn't drift more than a few minutes late, same urgency tier as invoice-due-reminder/health-snapshot
  },
  {
    key: "sequence-advancement",
    name: "Cold-email sequence advancement",
    cronExpression: "0 * * * *",
    handler: sequenceAdvancementJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 3, // outreach cadence matters but is measured in hours/days, not minutes
  },
  {
    key: "linkedin-draft-reminder",
    name: "LinkedIn draft reminder",
    cronExpression: "0 10 * * *",
    handler: linkedInReminderJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 3, // a reminder nudge, not a live user-facing action — same tier as other daily reminders
  },
  {
    key: "overdue-task-detection",
    name: "Overdue task detection",
    cronExpression: "*/30 * * * *",
    handler: overdueTaskDetectionJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 1, // runs every 30 minutes and drives real-time user-facing overdue notifications — highest urgency
  },
  {
    key: "proposal-follow-up-reminder",
    name: "Proposal follow-up reminder",
    cronExpression: "0 9 * * *",
    handler: proposalFollowUpReminderJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 3, // daily reminder nudge, same tier as the other once-a-day reminder jobs
  },
  {
    key: "invoice-due-reminder",
    name: "Invoice due/overdue reminder",
    cronExpression: "45 9 * * *",
    handler: invoiceDueReminderJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 2, // touches money (invoice overdue status + payment-chasing reminder) — more urgent than a plain reminder, just below real-time alerts
  },
  {
    key: "smart-alerts-evaluation",
    name: "Smart Alerts evaluation",
    cronExpression: "15 * * * *",
    handler: smartAlertsEvaluationJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 1, // hourly, user-facing alert engine — same top tier as overdue detection since staleness directly degrades the Alert Center
  },
  {
    key: "email-health-check",
    name: "Email sending health check (Phase 4)",
    cronExpression: "*/15 * * * *",
    handler: emailHealthCheckJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 1, // safety-critical circuit breaker — same top tier as Smart Alerts, checked more often (every 15 min) since a dangerous bounce/complaint spike shouldn't wait for the hourly alert cycle
  },
  {
    key: "health-snapshot",
    name: "Infrastructure health snapshot",
    cronExpression: "*/5 * * * *",
    handler: healthSnapshotJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 }, // a missed snapshot is fine — the next run in 5 minutes covers it, no point retrying a stale check
    priority: 2, // frequent (every 5 min) and feeds real-time alerting/uptime history — high urgency, just below the strictly real-time user-facing jobs
  },
  {
    key: "lead-discovery",
    name: "Autonomous lead discovery",
    cronExpression: "0 6 * * *",
    handler: leadDiscoveryJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // opt-in, non-urgent — runs before the research/scoring backlog job so newly-found companies have something to process
  },
  {
    key: "career-job-discovery",
    name: "AI Career Agent job discovery",
    // Once daily — real profile-level DAILY/WEEKLY cadence and the
    // provider's own 4-hour cooldown are enforced inside the handler
    // (career-discovery-job.ts / job-discovery.ts), not by this cron
    // expression alone.
    cronExpression: "0 7 * * *",
    handler: careerJobDiscoveryJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 }, // a missed run is fine — tomorrow's run (or the user's own "Search now") covers it; retrying risks exceeding Remotive's real rate-limit guidance
    priority: 5, // opt-in, personal (non-revenue) feature — lowest urgency tier
  },
  {
    key: "career-autonomous-application-submission",
    name: "AI Career Agent autonomous application submission",
    // After job discovery (7am) so newly discovered/matched jobs have a
    // chance to reach READY_FOR_REVIEW before this runs.
    cronExpression: "0 8 * * *",
    handler: autonomousApplicationSubmissionJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 }, // never auto-retried — a real safety gate re-runs fresh next cycle regardless
    priority: 5, // opt-in, personal feature — lowest urgency tier, same as job discovery
  },
  {
    key: "career-application-submission-status-check",
    name: "AI Career Agent submission status reconciliation",
    cronExpression: "*/30 * * * *",
    handler: submissionStatusReconciliationJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 4, // more time-sensitive than discovery — a real deliveredAt confirmation should reflect promptly
  },
  {
    key: "career-followup-scheduling",
    name: "AI Career Agent follow-up scheduling",
    cronExpression: "0 9 * * *",
    handler: careerFollowUpSchedulingJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 5,
  },
  {
    key: "career-followup-sending",
    name: "AI Career Agent follow-up sending",
    // Hourly — re-checks every stopping condition fresh at send time (§58); missing one hour's window just means it sends on the next pass.
    cronExpression: "0 * * * *",
    handler: careerFollowUpSendingJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 5,
  },
  {
    key: "career-market-snapshot-generation",
    name: "AI Career Agent job market snapshot generation",
    // Weekly, Sunday 6am — see careerMarketSnapshotJob's own doc comment.
    cronExpression: "0 6 * * 0",
    handler: careerMarketSnapshotJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 5,
  },
  // KVL sector outreach, split by target country's own business hours
  // (10:30am local) rather than one fixed IST time — see
  // kvl-sector-discovery-job.ts's top comment and COUNTRY_GROUPS. `tz` is
  // genuinely honored per-job by the active BullMQ scheduler provider
  // (scheduler/init.ts), so each of these really fires at 10:30am in ITS
  // OWN zone, not 10:30am IST for all six.
  {
    key: "kvl-outreach-india",
    name: "KVL business-hours outreach — India",
    cronExpression: "30 10 * * *",
    timezone: "Asia/Kolkata",
    handler: kvlCountryOutreachJob("india"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  {
    key: "kvl-outreach-uae",
    name: "KVL business-hours outreach — UAE",
    cronExpression: "30 10 * * *",
    timezone: "Asia/Dubai",
    handler: kvlCountryOutreachJob("uae"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  {
    key: "kvl-outreach-saudi",
    name: "KVL business-hours outreach — Saudi Arabia",
    cronExpression: "30 10 * * *",
    timezone: "Asia/Riyadh",
    handler: kvlCountryOutreachJob("saudi"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  {
    key: "kvl-outreach-usa",
    name: "KVL business-hours outreach — USA",
    cronExpression: "30 10 * * *",
    timezone: "America/New_York",
    handler: kvlCountryOutreachJob("usa"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  {
    key: "kvl-outreach-uk",
    name: "KVL business-hours outreach — UK",
    cronExpression: "30 10 * * *",
    timezone: "Europe/London",
    handler: kvlCountryOutreachJob("uk"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  {
    key: "kvl-outreach-malaysia",
    name: "KVL business-hours outreach — Malaysia",
    cronExpression: "30 10 * * *",
    timezone: "Asia/Kuala_Lumpur",
    handler: kvlCountryOutreachJob("malaysia"),
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  // 8pm IST — tops up to the 20/day floor if the 6 business-hours runs above
  // came in short (see runKvlDailyCatchup's doc comment).
  {
    key: "kvl-daily-catchup",
    name: "KVL daily outreach catch-up (20/day floor)",
    cronExpression: "0 20 * * *",
    timezone: "Asia/Kolkata",
    handler: kvlDailyCatchupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  // 9pm IST — the one daily owner-facing report, after every country run and
  // the catch-up have had their chance to run.
  {
    key: "kvl-daily-report",
    name: "KVL daily outreach report to owner",
    cronExpression: "0 21 * * *",
    timezone: "Asia/Kolkata",
    handler: kvlDailyReportJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4,
  },
  // Every 30 minutes — real IMAP read of sales@kvlbusinesssolutions.com
  // (KVL_IMAP_* env vars) so a prospect's reply becomes a real Reply record
  // (with AI sentiment) automatically, not just a "check your inbox
  // yourself" line in the daily report. Skips cleanly if unconfigured.
  {
    key: "kvl-reply-sync",
    name: "KVL sales inbox reply sync",
    cronExpression: "*/30 * * * *",
    handler: kvlReplySyncJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 3, // real inbound leads/replies — worth checking more promptly than the once-a-day jobs above
  },
  {
    key: "company-research-backlog",
    name: "Company research backlog",
    cronExpression: "*/30 * * * *",
    handler: companyResearchBacklogJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // opt-in, bounded batch (5 companies/org/run) — steady background progress, not time-critical
  },
  {
    key: "website-intelligence-sync",
    name: "Website intelligence evidence sync",
    cronExpression: "*/30 * * * *",
    handler: websiteIntelligenceSyncJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // opt-in, bounded batch (10 recent scans/org/run) — same tier as company-research-backlog, safe to retry whole-job since both underlying functions are idempotent
  },
  {
    key: "decision-maker-sync",
    name: "Decision-maker discovery sync",
    cronExpression: "*/30 * * * *",
    handler: decisionMakerSyncJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // opt-in, bounded batch (5 qualified companies/org/run) — same tier as company-research-backlog/website-intelligence-sync, safe to retry since discoverDecisionMakers is idempotent
  },
  {
    key: "revenue-attribution-recompute",
    name: "Revenue attribution recompute (Phase 7 Revenue Attribution Engine)",
    cronExpression: "0 4 * * *",
    handler: revenueAttributionRecomputeJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // deterministic, no AI spend, but a full-org sweep — nightly is enough since paid invoices don't change every few minutes
  },
  {
    key: "learning-engine-daily-run",
    name: "Closed-loop revenue learning engine (Phase 11)",
    cronExpression: "0 5 * * *",
    handler: runLearningEngineJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // deterministic, no AI spend; runs after revenue-attribution-recompute (4am) and prediction-calibration-refresh (1:30am) so it reads their freshest output
  },
  {
    key: "forecast-engine-daily-run",
    name: "Predictive revenue engine (Phase 12)",
    cronExpression: "30 5 * * *",
    handler: runForecastEngineJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // deterministic, no AI spend; runs after revenue-attribution-recompute (4am) and learning-engine-daily-run (5am) so it reads their freshest output
  },
  {
    key: "stale-company-reenrichment",
    name: "Stale company re-enrichment (Phase 1 Data & Enrichment Engine)",
    cronExpression: "0 3 * * *",
    handler: staleCompanyReenrichmentJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // opt-in, bounded batch (5 high-value + 5 normal companies/org/run) — daily (not 30-min like its siblings) since staleness is measured in days/weeks, not minutes; safe to retry, enrichCompany is idempotent
  },
  {
    key: "partner-discovery-sync",
    name: "Weekly AI partner discovery",
    cronExpression: "0 6 * * 1",
    handler: partnerDiscoverySyncJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // opt-in, real AI web-search spend per org, but a much lower-frequency need than lead/decision-maker discovery (a handful of good referral partners, not a continuously refreshed backlog) — weekly, same morning slot as growth-improvement-plan-refresh
  },
  {
    key: "client-health-snapshot",
    name: "Daily client health snapshot",
    cronExpression: "45 0 * * *",
    handler: clientHealthSnapshotJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 5, // nightly derived rollup, same tier as the analytics/project-health snapshots it runs alongside
  },
  {
    key: "growth-score-snapshot",
    name: "Daily Growth Score snapshot",
    cronExpression: "0 1 * * *",
    handler: growthScoreSnapshotJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 5, // nightly derived rollup — runs after client-health-snapshot (0:45) so customerSuccessScore reads today's data
  },
  {
    key: "growth-improvement-plan-refresh",
    name: "Weekly Growth Improvement Plan refresh",
    cronExpression: "0 6 * * 1",
    handler: growthImprovementPlanRefreshJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // weekly AI-generated guidance, not time-critical, but real spend so kept off the hourly/daily tiers
  },
  {
    key: "client-churn-assessment",
    name: "Daily client churn risk assessment",
    cronExpression: "15 1 * * *",
    handler: clientChurnAssessmentJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 4, // nightly derived rollup — runs after growth-score-snapshot (1:00) so it reads today's ClientHealthSnapshot
  },
  {
    key: "prediction-calibration-refresh",
    name: "Nightly win-probability calibration",
    cronExpression: "30 1 * * *",
    handler: predictionCalibrationJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 30_000 },
    priority: 5, // nightly derived rollup, same tier as growth-score-snapshot/client-churn-assessment — zero real AI spend (pure Prisma aggregation), no urgency
  },
  {
    key: "client-opportunity-scan",
    name: "Weekly client opportunity scan",
    cronExpression: "0 7 * * 1",
    handler: clientOpportunityScanJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // weekly, bounded batch (5 never-scanned clients/org/run) — real AI spend for the referral step, not time-critical
  },
  {
    key: "competitor-intelligence-refresh",
    name: "Weekly competitor intelligence refresh",
    cronExpression: "0 8 * * 1",
    handler: competitorIntelligenceRefreshJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 4, // weekly, real AI web-search spend per org — bounded cadence, not time-critical
  },
  {
    key: "market-trend-refresh",
    name: "Monthly market trend refresh",
    cronExpression: "0 8 1 * *",
    handler: marketTrendRefreshJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // monthly, real AI web-search spend per org — trends move slower than competitors, so a longer cadence
  },
  {
    key: "executive-insights-refresh",
    name: "Daily Executive Insights refresh",
    cronExpression: "0 7 * * 1-5",
    handler: executiveInsightsRefreshJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 3, // daily, before the 9am AI Executive Board meeting — same tier as other daily AI-generated content
  },
  {
    key: "insight-retention-cleanup",
    name: "Weekly Insight retention cleanup",
    cronExpression: "0 3 * * 0",
    handler: insightRetentionCleanupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 5, // weekly bulk deletion housekeeping — lowest priority, same tier as audit-log-retention-cleanup
  },
  {
    key: "daily-ceo-brief",
    name: "AI CEO Daily Brief",
    cronExpression: "0 6 * * 1-5",
    handler: dailyCeoBriefJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 60_000 },
    priority: 3, // daily, before the 9am AI Executive Board meeting — same morning-job ordering convention as executive-insights-refresh
  },
  {
    key: "nightly-database-backup",
    name: "Nightly database backup",
    cronExpression: "0 2 * * *",
    handler: nightlyDatabaseBackupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 5 * 60_000 },
    priority: 2, // real RPO-defining job — real data loss risk if this silently stops running, higher priority than derived-data rollups
  },
  {
    key: "weekly-storage-backup",
    name: "Weekly storage backup",
    cronExpression: "30 2 * * 0",
    handler: weeklyStorageBackupJob,
    retryPolicy: { maxAttempts: 2, backoffMs: 5 * 60_000 },
    priority: 3, // weekly — storage/ changes far less often than the database, doesn't need a nightly cadence
  },
  {
    key: "weekly-restore-test",
    name: "Weekly restore test",
    cronExpression: "0 3 * * 0",
    handler: weeklyRestoreTestJob,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    priority: 3, // weekly, 1 hour after nightly-database-backup's 2am run — verifies that same morning's database backup is genuinely restorable (Restore Testing)
  },
];
