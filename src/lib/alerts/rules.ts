import { prisma } from "@/lib/prisma";
import { computeProjectSpend } from "@/lib/projects/health";
import { computeProjectHealthScore } from "@/lib/projects/health-score";
import { computeChurnRisk } from "@/lib/clients/churn";
import { evaluateSendingIdentityHealth, HEALTH_THRESHOLDS } from "@/lib/outreach/sending-identity";
import type { RiskLevel } from "@/generated/prisma/client";

const DAY_MS = 86_400_000;
const OPEN_PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD"] as const;

/**
 * One real, DB-derived signal per possible trigger — never a fabricated
 * entry. `title`/`message`/`formula` together are the transparency contract
 * the Alert Center renders: exactly what was measured and why it crossed
 * the threshold.
 */
export interface AlertRuleResult {
  relatedEntityType?: string;
  relatedEntityId?: string;
  title: string;
  message: string;
  formula: string;
  metricValue: number;
  thresholdValue: number;
  severity: RiskLevel;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

interface RevenuePace {
  currentPace: number;
  avgPace: number;
}

/**
 * Real daily revenue pace from MetricSnapshot.revenueMonthToDate — this
 * month's pace is today's cumulative MTD revenue divided by how many days
 * of the month have elapsed; the baseline is the average of the last
 * (up to 3) fully-completed prior months' own real pace. Requires at least
 * 2 completed prior months of snapshot history to trust the baseline —
 * with less, returns null rather than comparing against a guess.
 */
async function computeRevenuePace(organizationId: string): Promise<RevenuePace | null> {
  const snapshots = await prisma.metricSnapshot.findMany({
    where: { organizationId },
    orderBy: { date: "desc" },
    select: { date: true, revenueMonthToDate: true },
  });
  if (snapshots.length === 0) return null;

  const latest = snapshots[0];
  const currentMonth = monthKey(latest.date);
  const dayOfMonth = latest.date.getDate();
  const currentPace = dayOfMonth > 0 ? latest.revenueMonthToDate / dayOfMonth : 0;

  // Last snapshot recorded for each prior month = that month's real completed MTD total.
  const lastSnapshotByMonth = new Map<string, { date: Date; revenueMonthToDate: number }>();
  for (const snap of snapshots) {
    const key = monthKey(snap.date);
    if (key === currentMonth) continue;
    const existing = lastSnapshotByMonth.get(key);
    if (!existing || snap.date > existing.date) lastSnapshotByMonth.set(key, snap);
  }

  const priorMonths = [...lastSnapshotByMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  if (priorMonths.length < 2) return null;

  const paces = priorMonths.map(([key, snap]) => {
    const [year, month] = key.split("-").map(Number);
    return snap.revenueMonthToDate / daysInMonth(new Date(year, month - 1, 1));
  });
  const avgPace = paces.reduce((sum, p) => sum + p, 0) / paces.length;

  return { currentPace, avgPace };
}

export async function evaluateRevenueDrop(organizationId: string): Promise<AlertRuleResult[]> {
  const pace = await computeRevenuePace(organizationId);
  if (!pace || pace.avgPace <= 0) return [];
  const ratio = pace.currentPace / pace.avgPace;
  if (ratio >= 0.8) return [];

  const severity: RiskLevel = ratio < 0.5 ? "CRITICAL" : ratio < 0.65 ? "HIGH" : "MEDIUM";
  return [
    {
      title: "Revenue pace has dropped",
      message: `This month's daily revenue pace is ${pace.currentPace.toFixed(2)}/day, ${Math.round((1 - ratio) * 100)}% below the trailing 3-month average pace of ${pace.avgPace.toFixed(2)}/day.`,
      formula: `currentPace (${pace.currentPace.toFixed(2)}) < 0.8 × trailing3MonthAvgPace (${pace.avgPace.toFixed(2)})`,
      metricValue: pace.currentPace,
      thresholdValue: pace.avgPace * 0.8,
      severity,
    },
  ];
}

export async function evaluateRevenueSpike(organizationId: string): Promise<AlertRuleResult[]> {
  const pace = await computeRevenuePace(organizationId);
  if (!pace || pace.avgPace <= 0) return [];
  const ratio = pace.currentPace / pace.avgPace;
  if (ratio <= 1.5) return [];

  const severity: RiskLevel = ratio > 2.5 ? "HIGH" : "MEDIUM";
  return [
    {
      title: "Revenue pace has spiked",
      message: `This month's daily revenue pace is ${pace.currentPace.toFixed(2)}/day, ${Math.round((ratio - 1) * 100)}% above the trailing 3-month average pace of ${pace.avgPace.toFixed(2)}/day.`,
      formula: `currentPace (${pace.currentPace.toFixed(2)}) > 1.5 × trailing3MonthAvgPace (${pace.avgPace.toFixed(2)})`,
      metricValue: pace.currentPace,
      thresholdValue: pace.avgPace * 1.5,
      severity,
    },
  ];
}

/**
 * Real 7-day vs prior-7-day average MetricSnapshot.pipelineValue — needs at
 * least 14 distinct daily snapshots (2 full trailing weeks), else skipped.
 */
export async function evaluatePipelineDecline(organizationId: string): Promise<AlertRuleResult[]> {
  const snapshots = await prisma.metricSnapshot.findMany({
    where: { organizationId },
    orderBy: { date: "desc" },
    take: 14,
    select: { pipelineValue: true },
  });
  if (snapshots.length < 14) return [];

  const last7 = snapshots.slice(0, 7);
  const prior7 = snapshots.slice(7, 14);
  const avgLast7 = last7.reduce((sum, s) => sum + s.pipelineValue, 0) / 7;
  const avgPrior7 = prior7.reduce((sum, s) => sum + s.pipelineValue, 0) / 7;
  if (avgPrior7 <= 0) return [];

  const decline = (avgPrior7 - avgLast7) / avgPrior7;
  if (decline <= 0.25) return [];

  const severity: RiskLevel = decline > 0.5 ? "CRITICAL" : decline > 0.35 ? "HIGH" : "MEDIUM";
  return [
    {
      title: "Pipeline value is declining",
      message: `The 7-day average pipeline value is ${avgLast7.toFixed(2)}, down ${Math.round(decline * 100)}% from the prior 7-day average of ${avgPrior7.toFixed(2)}.`,
      formula: `avgLast7Days (${avgLast7.toFixed(2)}) < 0.75 × avgPrior7Days (${avgPrior7.toFixed(2)})`,
      metricValue: avgLast7,
      thresholdValue: avgPrior7 * 0.75,
      severity,
    },
  ];
}

const CLIENT_CHURN_ALERT_THRESHOLD = 70;

/**
 * Real ACTIVE clients with a real contract value, evaluated against the
 * deterministic multi-factor ChurnRiskAssessment (src/lib/clients/churn.ts,
 * Phase 5 of the AI Business Growth Engine) instead of the single
 * days-since-activity signal this used to compute inline. A client with no
 * ClientHealthSnapshot yet (the nightly job hasn't scored it) is honestly
 * skipped, not treated as zero risk.
 */
export async function evaluateClientChurnRisk(organizationId: string): Promise<AlertRuleResult[]> {
  const clients = await prisma.client.findMany({
    where: { organizationId, status: "ACTIVE", contractValue: { not: null } },
    select: { id: true, name: true, contractValue: true },
  });

  const results: AlertRuleResult[] = [];

  for (const client of clients) {
    const computation = await computeChurnRisk(client.id);
    if (!computation || computation.probabilityScore < CLIENT_CHURN_ALERT_THRESHOLD) continue;

    const topReason = [...computation.reasons].sort((a, b) => b.contribution - a.contribution)[0];
    results.push({
      relatedEntityType: "Client",
      relatedEntityId: client.id,
      title: `Client "${client.name}" is at churn risk`,
      message: `"${client.name}" (contract value ${client.contractValue}) has a real churn probability of ${computation.probabilityScore}/100, driven most by ${topReason.factor} (score ${topReason.value}/100).`,
      formula: `churnProbabilityScore (${computation.probabilityScore}) >= ${CLIENT_CHURN_ALERT_THRESHOLD} — weighted from ClientHealthSnapshot's engagement/payment/contract/delivery factors`,
      metricValue: computation.probabilityScore,
      thresholdValue: CLIENT_CHURN_ALERT_THRESHOLD,
      severity: computation.riskLevel,
    });
  }

  return results;
}

// Exported for reuse by src/lib/forecast/deal-risk.ts (Phase 12) — same
// stalled-deal threshold, never redefined with a different number.
export const DEAL_STALLED_DAYS = 14;
// Matches the real Deal Stage seed names (src/app/onboarding/agents-actions.ts) —
// there is no separate "is this stage closed" flag on DealStage.
const CLOSED_DEAL_STAGE_NAMES = ["Won", "Lost", "Archived"];

/**
 * Real open Deals (not in a closed stage) whose real expectedCloseDate is
 * more than 14 days in the past — the honest, no-fabricated-target proxy
 * for "missed target" since this schema has no SalesTarget/quota model.
 */
export async function evaluateDealStalled(organizationId: string): Promise<AlertRuleResult[]> {
  const cutoff = new Date(Date.now() - DEAL_STALLED_DAYS * DAY_MS);
  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      expectedCloseDate: { lt: cutoff },
      dealStage: { name: { notIn: CLOSED_DEAL_STAGE_NAMES } },
    },
    select: { id: true, name: true, expectedCloseDate: true, value: true },
  });

  const now = Date.now();
  return deals.map((deal) => {
    const daysStalled = Math.round((now - deal.expectedCloseDate!.getTime()) / DAY_MS);
    const severity: RiskLevel = daysStalled > 60 ? "CRITICAL" : daysStalled > 30 ? "HIGH" : "MEDIUM";
    return {
      relatedEntityType: "Deal",
      relatedEntityId: deal.id,
      title: `Deal "${deal.name}" has stalled`,
      message: `"${deal.name}"${deal.value != null ? ` (value ${deal.value})` : ""} was expected to close ${daysStalled} day(s) ago and is still open.`,
      formula: `daysPastExpectedCloseDate (${daysStalled}) > ${DEAL_STALLED_DAYS}`,
      metricValue: daysStalled,
      thresholdValue: DEAL_STALLED_DAYS,
      severity,
    };
  });
}

/**
 * Real spend-ratio overrun on open Projects with a real budget — reuses
 * computeProjectSpend (src/lib/projects/health.ts) rather than
 * re-deriving billable-hours × rate math.
 */
export async function evaluateBudgetOverrun(organizationId: string): Promise<AlertRuleResult[]> {
  const projects = await prisma.project.findMany({
    where: { organizationId, status: { in: Array.from(OPEN_PROJECT_STATUSES) as never[] }, budget: { not: null } },
    select: { id: true, name: true, budget: true },
  });

  const results: AlertRuleResult[] = [];
  for (const project of projects) {
    if (!project.budget || project.budget <= 0) continue;
    const spend = await computeProjectSpend(project.id);
    const ratio = spend / project.budget;
    if (ratio <= 1) continue;

    const severity: RiskLevel = ratio > 1.5 ? "CRITICAL" : ratio > 1.2 ? "HIGH" : "MEDIUM";
    results.push({
      relatedEntityType: "Project",
      relatedEntityId: project.id,
      title: `Project "${project.name}" is over budget`,
      message: `"${project.name}" has real logged spend of ${spend.toFixed(2)} against a budget of ${project.budget} (${Math.round(ratio * 100)}%).`,
      formula: `spend (${spend.toFixed(2)}) / budget (${project.budget}) > 1.0`,
      metricValue: Math.round(ratio * 100),
      thresholdValue: 100,
      severity,
    });
  }
  return results;
}

/**
 * Real unpaid Invoices past their due date — one per overdue invoice.
 * amountPaid < grandTotal guards against a status that hasn't caught up
 * with a just-recorded payment yet (same check invoiceDueReminderJob uses).
 */
export async function evaluateLatePayment(organizationId: string): Promise<AlertRuleResult[]> {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: { organizationId, status: { in: ["SENT", "OVERDUE"] }, dueDate: { lt: now } },
    select: { id: true, invoiceNumber: true, dueDate: true, grandTotal: true, amountPaid: true },
  });

  return invoices
    .filter((inv) => inv.amountPaid < inv.grandTotal)
    .map((inv) => {
      const daysOverdue = Math.round((now.getTime() - inv.dueDate!.getTime()) / DAY_MS);
      const remaining = inv.grandTotal - inv.amountPaid;
      const severity: RiskLevel = daysOverdue > 60 ? "CRITICAL" : daysOverdue > 30 ? "HIGH" : daysOverdue > 14 ? "MEDIUM" : "LOW";
      return {
        relatedEntityType: "Invoice",
        relatedEntityId: inv.id,
        title: `Invoice ${inv.invoiceNumber} is overdue`,
        message: `Invoice ${inv.invoiceNumber} for ${remaining.toFixed(2)} is ${daysOverdue} day(s) past its due date.`,
        formula: `daysOverdue (${daysOverdue}) > 0 and amountPaid (${inv.amountPaid}) < grandTotal (${inv.grandTotal})`,
        metricValue: daysOverdue,
        thresholdValue: 0,
        severity,
      };
    });
}

/**
 * Reuses computeProjectHealthScore (src/lib/projects/health-score.ts) —
 * fires when a real open project's deliveryScore or velocityScore drops
 * below 50, rather than re-deriving those scores here.
 */
export async function evaluateProjectDelay(organizationId: string): Promise<AlertRuleResult[]> {
  const projects = await prisma.project.findMany({
    where: { organizationId, status: { in: Array.from(OPEN_PROJECT_STATUSES) as never[] } },
    select: { id: true, name: true },
  });

  const results: AlertRuleResult[] = [];
  for (const project of projects) {
    const scores = await computeProjectHealthScore(project.id);
    const minScore = Math.min(scores.deliveryScore, scores.velocityScore);
    if (minScore >= 50) continue;

    const severity: RiskLevel = minScore < 25 ? "CRITICAL" : minScore < 40 ? "HIGH" : "MEDIUM";
    results.push({
      relatedEntityType: "Project",
      relatedEntityId: project.id,
      title: `Project "${project.name}" delivery is at risk`,
      message: `"${project.name}" has a delivery score of ${scores.deliveryScore}/100 and a velocity score of ${scores.velocityScore}/100 — one or both are below the 50 threshold.`,
      formula: `min(deliveryScore (${scores.deliveryScore}), velocityScore (${scores.velocityScore})) < 50`,
      metricValue: minScore,
      thresholdValue: 50,
      severity,
    });
  }
  return results;
}

const API_KEY_STALE_DAYS = 90;
const DEVICE_SESSION_WINDOW_HOURS = 24;
const DEVICE_SESSION_THRESHOLD = 3;

/**
 * Three real, independent security signals combined into one rule (all
 * share AlertType.SECURITY_RISK, differentiated by relatedEntityId):
 * (a) an OWNER/ADMIN membership whose real User.twoFactorEnabled is false,
 * (b) a real, non-revoked ApiKey unused for 90+ days,
 * (c) a real surge (>3) of untrusted DeviceSession rows created in the last
 * 24h across the organization's members.
 */
export async function evaluateSecurityRisk(organizationId: string): Promise<AlertRuleResult[]> {
  const now = new Date();
  const apiKeyCutoff = new Date(now.getTime() - API_KEY_STALE_DAYS * DAY_MS);
  const deviceSessionCutoff = new Date(now.getTime() - DEVICE_SESSION_WINDOW_HOURS * 60 * 60 * 1000);

  const [privilegedNo2FA, staleApiKeys, untrustedSessionCount] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, user: { twoFactorEnabled: false } },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
    prisma.apiKey.findMany({
      where: {
        organizationId,
        revokedAt: null,
        OR: [{ lastUsedAt: { lt: apiKeyCutoff } }, { lastUsedAt: null, createdAt: { lt: apiKeyCutoff } }],
      },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
    }),
    prisma.deviceSession.count({
      where: {
        trusted: false,
        createdAt: { gte: deviceSessionCutoff },
        user: { memberships: { some: { organizationId, status: "ACTIVE" } } },
      },
    }),
  ]);

  const results: AlertRuleResult[] = [];

  for (const membership of privilegedNo2FA) {
    const label = membership.user.name ?? membership.user.email ?? "A team member";
    results.push({
      relatedEntityType: "User",
      relatedEntityId: membership.userId,
      title: `${membership.role === "OWNER" ? "Owner" : "Admin"} account without 2FA`,
      message: `${label} (${membership.role}) does not have two-factor authentication enabled.`,
      formula: `role IN (OWNER, ADMIN) and User.twoFactorEnabled = false`,
      metricValue: 0,
      thresholdValue: 1,
      severity: membership.role === "OWNER" ? "CRITICAL" : "HIGH",
    });
  }

  for (const key of staleApiKeys) {
    const referenceDate = key.lastUsedAt ?? key.createdAt;
    const daysStale = Math.round((now.getTime() - referenceDate.getTime()) / DAY_MS);
    results.push({
      relatedEntityType: "ApiKey",
      relatedEntityId: key.id,
      title: `API key "${key.name}" is stale`,
      message: `API key "${key.name}" has not been used in ${daysStale} day(s) and is still active (not revoked).`,
      formula: `daysSinceLastUse (${daysStale}) > ${API_KEY_STALE_DAYS} and revokedAt IS NULL`,
      metricValue: daysStale,
      thresholdValue: API_KEY_STALE_DAYS,
      severity: "MEDIUM",
    });
  }

  if (untrustedSessionCount > DEVICE_SESSION_THRESHOLD) {
    results.push({
      relatedEntityType: "Organization",
      relatedEntityId: "untrusted-device-sessions",
      title: "Unusual untrusted device sign-in activity",
      message: `${untrustedSessionCount} untrusted device session(s) were created in the last ${DEVICE_SESSION_WINDOW_HOURS} hours across this organization.`,
      formula: `untrustedDeviceSessionsLast24h (${untrustedSessionCount}) > ${DEVICE_SESSION_THRESHOLD}`,
      metricValue: untrustedSessionCount,
      thresholdValue: DEVICE_SESSION_THRESHOLD,
      severity: "HIGH",
    });
  }

  return results;
}

// ============================= Business Risk Engine (AI Business Growth Engine) =============================
// Two additional deterministic rules, same discipline as every rule above —
// real DB aggregate crossing a documented threshold, never an LLM guess.

const REVENUE_CONCENTRATION_TRAILING_MONTHS = 12;
const REVENUE_CONCENTRATION_THRESHOLD_PCT = 40;
const RESOURCE_UTILIZATION_TRAILING_DAYS = 7;
const RESOURCE_UTILIZATION_THRESHOLD_PCT = 100;

/**
 * Real trailing-12-month paid-Invoice revenue, grouped by Client — fires
 * when the single largest client's share exceeds 40%. Only invoices with a
 * real clientId attached are counted (the denominator is "revenue
 * attributable to a specific client", stated honestly in `formula`, not
 * total org revenue). Requires at least 2 distinct paying clients — a
 * single-client org is trivially "100% concentrated" by having only one
 * client at all, which isn't an actionable diversification risk the way a
 * skew among many clients is.
 */
export async function evaluateRevenueConcentration(organizationId: string): Promise<AlertRuleResult[]> {
  const cutoff = new Date(Date.now() - REVENUE_CONCENTRATION_TRAILING_MONTHS * 30 * DAY_MS);
  const invoices = await prisma.invoice.findMany({
    where: { organizationId, status: "PAID", clientId: { not: null }, paidAt: { gte: cutoff } },
    select: { clientId: true, grandTotal: true },
  });

  const revenueByClient = new Map<string, number>();
  for (const invoice of invoices) {
    if (!invoice.clientId) continue;
    revenueByClient.set(invoice.clientId, (revenueByClient.get(invoice.clientId) ?? 0) + invoice.grandTotal);
  }
  if (revenueByClient.size < 2) return [];

  const totalRevenue = Array.from(revenueByClient.values()).reduce((sum, v) => sum + v, 0);
  if (totalRevenue <= 0) return [];

  const [topClientId, topRevenue] = Array.from(revenueByClient.entries()).sort((a, b) => b[1] - a[1])[0];
  const sharePct = (topRevenue / totalRevenue) * 100;
  if (sharePct <= REVENUE_CONCENTRATION_THRESHOLD_PCT) return [];

  const client = await prisma.client.findUnique({ where: { id: topClientId }, select: { name: true } });
  const severity: RiskLevel = sharePct > 70 ? "CRITICAL" : sharePct > 55 ? "HIGH" : "MEDIUM";

  return [
    {
      relatedEntityType: "Client",
      relatedEntityId: topClientId,
      title: `Revenue is concentrated in one client: "${client?.name ?? topClientId}"`,
      message: `"${client?.name ?? topClientId}" accounts for ${sharePct.toFixed(1)}% of real client-attributed revenue over the trailing ${REVENUE_CONCENTRATION_TRAILING_MONTHS} months (${topRevenue.toFixed(2)} of ${totalRevenue.toFixed(2)}).`,
      formula: `topClientRevenueShare (${sharePct.toFixed(1)}%) > ${REVENUE_CONCENTRATION_THRESHOLD_PCT}% — Σ PAID Invoice.grandTotal grouped by clientId, trailing ${REVENUE_CONCENTRATION_TRAILING_MONTHS} months, among invoices with a client attached`,
      metricValue: Math.round(sharePct * 10) / 10,
      thresholdValue: REVENUE_CONCENTRATION_THRESHOLD_PCT,
      severity,
    },
  ];
}

/**
 * Real Σ TimeEntry.durationMinutes logged in the trailing 7 days across
 * open projects, vs. real Σ ProjectMember.capacityHoursPerWeek on those
 * same open projects — fires when logged hours exceed stated capacity
 * (the team is working more than its own declared bandwidth). Requires at
 * least one ProjectMember with a real capacityHoursPerWeek set — orgs that
 * never fill that field in have no honest baseline to compare against and
 * are skipped, not treated as zero risk.
 */
export async function evaluateResourceShortage(organizationId: string): Promise<AlertRuleResult[]> {
  const cutoff = new Date(Date.now() - RESOURCE_UTILIZATION_TRAILING_DAYS * DAY_MS);

  const [members, timeEntries] = await Promise.all([
    prisma.projectMember.findMany({
      where: { organizationId, capacityHoursPerWeek: { not: null }, project: { status: { in: Array.from(OPEN_PROJECT_STATUSES) as never[] } } },
      select: { capacityHoursPerWeek: true },
    }),
    prisma.timeEntry.findMany({
      where: { organizationId, startedAt: { gte: cutoff }, durationMinutes: { not: null }, project: { status: { in: Array.from(OPEN_PROJECT_STATUSES) as never[] } } },
      select: { durationMinutes: true },
    }),
  ]);

  if (members.length === 0) return [];

  const totalWeeklyCapacityHours = members.reduce((sum, m) => sum + (m.capacityHoursPerWeek ?? 0), 0);
  if (totalWeeklyCapacityHours <= 0) return [];

  const loggedHours = timeEntries.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0) / 60;
  const utilizationPct = (loggedHours / totalWeeklyCapacityHours) * 100;
  if (utilizationPct <= RESOURCE_UTILIZATION_THRESHOLD_PCT) return [];

  const severity: RiskLevel = utilizationPct > 150 ? "CRITICAL" : utilizationPct > 125 ? "HIGH" : "MEDIUM";

  return [
    {
      relatedEntityType: "Organization",
      relatedEntityId: "resource-utilization",
      title: "Team is over real declared capacity",
      message: `${loggedHours.toFixed(1)} real hour(s) were logged in the last ${RESOURCE_UTILIZATION_TRAILING_DAYS} days across open projects, vs ${totalWeeklyCapacityHours.toFixed(1)} real declared weekly capacity hour(s) — ${utilizationPct.toFixed(0)}% utilization.`,
      formula: `utilization (${utilizationPct.toFixed(0)}%) > ${RESOURCE_UTILIZATION_THRESHOLD_PCT}% — Σ TimeEntry.durationMinutes (trailing ${RESOURCE_UTILIZATION_TRAILING_DAYS} days, open projects) ÷ Σ ProjectMember.capacityHoursPerWeek (open projects) × 100`,
      metricValue: Math.round(utilizationPct),
      thresholdValue: RESOURCE_UTILIZATION_THRESHOLD_PCT,
      severity,
    },
  ];
}

// ============================= HR Agent (Marketplace & AI Skills Ecosystem) =============================

const LATE_LEAVE_APPROVAL_DAYS = 3;

/** Real PENDING LeaveRequest rows sitting unreviewed for too long — a real staffing-planning risk for the requester's manager. */
export async function evaluateLateLeaveApproval(organizationId: string): Promise<AlertRuleResult[]> {
  const cutoff = new Date(Date.now() - LATE_LEAVE_APPROVAL_DAYS * DAY_MS);
  const requests = await prisma.leaveRequest.findMany({
    where: { organizationId, status: "PENDING", createdAt: { lt: cutoff } },
    include: { user: { select: { name: true, email: true } } },
  });

  const now = Date.now();
  return requests.map((request) => {
    const daysPending = Math.round((now - request.createdAt.getTime()) / DAY_MS);
    const severity: RiskLevel = daysPending > 10 ? "CRITICAL" : daysPending > 5 ? "HIGH" : "MEDIUM";
    const requesterLabel = request.user.name ?? request.user.email ?? "A team member";
    return {
      relatedEntityType: "LeaveRequest",
      relatedEntityId: request.id,
      title: `Leave request from ${requesterLabel} is still pending`,
      message: `${requesterLabel}'s ${request.type.toLowerCase()} leave request (${request.startDate.toDateString()} – ${request.endDate.toDateString()}) has been pending for ${daysPending} day(s).`,
      formula: `daysPending (${daysPending}) > ${LATE_LEAVE_APPROVAL_DAYS}`,
      metricValue: daysPending,
      thresholdValue: LATE_LEAVE_APPROVAL_DAYS,
      severity,
    };
  });
}

// ============================= Support Agent (Marketplace & AI Skills Ecosystem) =============================

const OPEN_SUPPORT_STATUSES = ["BACKLOG", "RUNNING", "BLOCKED"] as const;

/** Real TaskType.SUPPORT tasks past their real dueDate (used as the SLA deadline) and still open — the honest, no-fabricated-SLA-model proxy, same convention as evaluateDealStalled's use of expectedCloseDate. */
export async function evaluateSupportSlaBreach(organizationId: string): Promise<AlertRuleResult[]> {
  const now = new Date();
  const tickets = await prisma.task.findMany({
    where: { organizationId, type: "SUPPORT", dueDate: { lt: now }, status: { in: Array.from(OPEN_SUPPORT_STATUSES) as never[] } },
    select: { id: true, title: true, dueDate: true, priority: true },
  });

  return tickets.map((ticket) => {
    const hoursOverdue = Math.round((now.getTime() - ticket.dueDate!.getTime()) / (60 * 60 * 1000));
    const severity: RiskLevel = ticket.priority === "URGENT" || hoursOverdue > 48 ? "CRITICAL" : hoursOverdue > 24 ? "HIGH" : "MEDIUM";
    return {
      relatedEntityType: "Task",
      relatedEntityId: ticket.id,
      title: `Support ticket past SLA: "${ticket.title}"`,
      message: `"${ticket.title}" is ${hoursOverdue} hour(s) past its real SLA deadline and still open.`,
      formula: `hoursOverdue (${hoursOverdue}) > 0 — real Task.dueDate used as the SLA deadline, status still open`,
      metricValue: hoursOverdue,
      thresholdValue: 0,
      severity,
    };
  });
}

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — reuses
 * evaluateSendingIdentityHealth (sending-identity.ts) as the single source
 * of truth for the actual bounce/complaint math; this rule only decides
 * whether that real result is alert-worthy. WARNING and CRITICAL both
 * surface (CRITICAL already triggers the automatic pause inside
 * evaluateSendingIdentityHealth itself — this alert is the visible record
 * of that, not a second decision-maker).
 */
export async function evaluateEmailDeliverabilityRisk(organizationId: string): Promise<AlertRuleResult[]> {
  const identities = await prisma.sendingIdentity.findMany({ where: { organizationId } });
  const results: AlertRuleResult[] = [];

  for (const identity of identities) {
    const health = await evaluateSendingIdentityHealth(identity);
    if (health.status !== "WARNING" && health.status !== "CRITICAL") continue;

    const severity: RiskLevel = health.status === "CRITICAL" ? "CRITICAL" : "MEDIUM";
    const worstFactor = health.factors.find((f) => f.status === health.status) ?? health.factors[0];

    results.push({
      relatedEntityType: "SendingIdentity",
      relatedEntityId: identity.id,
      title: `Sending identity ${health.status === "CRITICAL" ? "paused" : "at risk"}: ${identity.email}`,
      message: `${worstFactor?.label ?? "Deliverability"}: ${worstFactor?.detail ?? "see health breakdown"}${health.action ? ` — ${health.action}` : ""}`,
      formula: `hardBounceRate >= ${HEALTH_THRESHOLDS.HARD_BOUNCE_CRITICAL_PCT}% (critical) or ${HEALTH_THRESHOLDS.HARD_BOUNCE_WARNING_PCT}% (warning); complaintRate >= ${HEALTH_THRESHOLDS.COMPLAINT_CRITICAL_PCT}% (critical) or ${HEALTH_THRESHOLDS.COMPLAINT_WARNING_PCT}% (warning); minimum sample ${HEALTH_THRESHOLDS.MIN_SAMPLE} real sends`,
      metricValue: health.hardBounceRate ?? health.complaintRate ?? 0,
      thresholdValue: health.status === "CRITICAL" ? HEALTH_THRESHOLDS.HARD_BOUNCE_CRITICAL_PCT : HEALTH_THRESHOLDS.HARD_BOUNCE_WARNING_PCT,
      severity,
    });
  }

  return results;
}

/**
 * Phase 12 (Predictive Revenue Engine) — a single open Deal whose
 * deterministic risk assessment (src/lib/forecast/deal-risk.ts, every
 * reason cited with real evidence) reached CRITICAL.
 */
export async function evaluateDealRiskCritical(organizationId: string): Promise<AlertRuleResult[]> {
  const { computeDealRisk } = await import("@/lib/forecast/deal-risk");
  const openDeals = await prisma.deal.findMany({
    where: { organizationId, dealStage: { name: { notIn: ["Won", "Lost", "Archived"] } } },
    select: { id: true, name: true, value: true },
  });
  if (openDeals.length === 0) return [];

  const results: AlertRuleResult[] = [];
  for (const deal of openDeals) {
    const risk = await computeDealRisk(deal.id);
    if (risk.riskLevel !== "CRITICAL") continue;
    results.push({
      relatedEntityType: "Deal",
      relatedEntityId: deal.id,
      title: `Deal "${deal.name}" is at critical risk`,
      message: `"${deal.name}"${deal.value != null ? ` (value ${deal.value})` : ""}: ${risk.reasons.map((r) => r.reason).join("; ")}.`,
      formula: `${risk.reasons.length} real risk signal(s) fired (CRITICAL threshold: 4+) — see src/lib/forecast/deal-risk.ts`,
      metricValue: risk.reasons.length,
      thresholdValue: 4,
      severity: "CRITICAL",
    });
  }
  return results;
}

const PIPELINE_CONCENTRATION_ENTITY_ID = "org-pipeline";

/**
 * Phase 12 — the org's real weighted open pipeline is concentrated in too
 * few deals (src/lib/forecast/pipeline-risk.ts). Org-wide, so
 * relatedEntityId is a fixed sentinel (Alert's real unique constraint is
 * [organizationId, type, relatedEntityId] — a stable, non-null value here
 * keeps this a real single row per org instead of colliding with null-based
 * uniqueness quirks, same reasoning Phase 11 used for its
 * NO_OPPORTUNITY_SENTINEL).
 */
export async function evaluatePipelineConcentrationRisk(organizationId: string): Promise<AlertRuleResult[]> {
  const { computePipelineRisk } = await import("@/lib/forecast/pipeline-risk");
  const risk = await computePipelineRisk(organizationId);
  if (risk.riskLevel !== "HIGH" && risk.riskLevel !== "CRITICAL") return [];

  const severity: RiskLevel = risk.riskLevel;
  const topShare = risk.concentration.top1Share ?? risk.concentration.top3Share;
  return [
    {
      relatedEntityType: "Organization",
      relatedEntityId: PIPELINE_CONCENTRATION_ENTITY_ID,
      title: "Pipeline concentration risk",
      message: risk.reasons.map((r) => `${r.reason}: ${r.evidence}`).join(" "),
      formula: `${risk.reasons.length} real concentration/stall/balance signal(s) fired — see src/lib/forecast/pipeline-risk.ts`,
      metricValue: topShare !== null ? Math.round(topShare * 1000) / 10 : risk.reasons.length,
      thresholdValue: 40,
      severity,
    },
  ];
}
