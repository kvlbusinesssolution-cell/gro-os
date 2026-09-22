import { prisma } from "@/lib/prisma";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { emailOrganizationOwners } from "@/lib/email";
import {
  evaluateRevenueDrop,
  evaluateRevenueSpike,
  evaluatePipelineDecline,
  evaluateClientChurnRisk,
  evaluateDealStalled,
  evaluateBudgetOverrun,
  evaluateLatePayment,
  evaluateProjectDelay,
  evaluateSecurityRisk,
  evaluateRevenueConcentration,
  evaluateResourceShortage,
  evaluateLateLeaveApproval,
  evaluateSupportSlaBreach,
  evaluateEmailDeliverabilityRisk,
  evaluateDealRiskCritical,
  evaluatePipelineConcentrationRisk,
  evaluateIntentSurge,
  type AlertRuleResult,
} from "./rules";
import { generateMitigationSuggestions } from "./mitigation";
import type { AlertType } from "@/generated/prisma/client";

const RULES: Record<AlertType, (organizationId: string) => Promise<AlertRuleResult[]>> = {
  REVENUE_DROP: evaluateRevenueDrop,
  REVENUE_SPIKE: evaluateRevenueSpike,
  PIPELINE_DECLINE: evaluatePipelineDecline,
  CLIENT_CHURN_RISK: evaluateClientChurnRisk,
  DEAL_STALLED: evaluateDealStalled,
  BUDGET_OVERRUN: evaluateBudgetOverrun,
  LATE_PAYMENT: evaluateLatePayment,
  PROJECT_DELAY: evaluateProjectDelay,
  SECURITY_RISK: evaluateSecurityRisk,
  REVENUE_CONCENTRATION: evaluateRevenueConcentration,
  RESOURCE_SHORTAGE: evaluateResourceShortage,
  LATE_LEAVE_APPROVAL: evaluateLateLeaveApproval,
  SUPPORT_SLA_BREACH: evaluateSupportSlaBreach,
  EMAIL_DELIVERABILITY_RISK: evaluateEmailDeliverabilityRisk,
  DEAL_RISK_CRITICAL: evaluateDealRiskCritical,
  PIPELINE_CONCENTRATION_RISK: evaluatePipelineConcentrationRisk,
  INTENT_SURGE: evaluateIntentSurge,
};

/**
 * Runs every deterministic Smart Alert rule for one organization and
 * reconciles the real Alert table against the results — no LLM guessing,
 * every trigger traces to a real rule in rules.ts.
 *
 * Because Alert has a real DB-level unique constraint on
 * [organizationId, type, relatedEntityId], a given (type, entity) pair has
 * at most one Alert row ever, regardless of status — so a re-trigger after
 * RESOLVED/ACKNOWLEDGED must reactivate that same row (upsert-style), not
 * insert a second one:
 *   - not currently tracked -> create ACTIVE + notify (real notification).
 *   - tracked and ACTIVE -> update metricValue/triggeredAt only, no re-notify
 *     (same "notify once per crossing" precedent as DELIVERY_HEALTH_DROPPED).
 *   - tracked but RESOLVED/ACKNOWLEDGED -> this is a fresh crossing, flip
 *     back to ACTIVE and notify again.
 * Any ACTIVE alert for a (type, entity) pair that no longer appears in this
 * run's results is auto-resolved — self-healing (e.g. an overdue invoice
 * gets paid, its LATE_PAYMENT alert resolves on the next evaluation).
 */
export async function evaluateAlerts(organizationId: string): Promise<void> {
  const ruleEntries = Object.entries(RULES) as [AlertType, (organizationId: string) => Promise<AlertRuleResult[]>][];
  const perTypeResults = await Promise.all(
    ruleEntries.map(async ([type, rule]) => [type, await rule(organizationId)] as const),
  );

  for (const [type, results] of perTypeResults) {
    const existingAlerts = await prisma.alert.findMany({ where: { organizationId, type } });
    const firingIds = new Set(results.map((r) => r.relatedEntityId ?? null));

    for (const alert of existingAlerts) {
      if (alert.status === "ACTIVE" && !firingIds.has(alert.relatedEntityId)) {
        await prisma.alert.update({ where: { id: alert.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      }
    }

    for (const result of results) {
      const relatedEntityId = result.relatedEntityId ?? null;
      const existing = existingAlerts.find((a) => a.relatedEntityId === relatedEntityId);

      if (existing?.status === "ACTIVE") {
        await prisma.alert.update({
          where: { id: existing.id },
          data: { metricValue: result.metricValue, triggeredAt: new Date() },
        });
        continue;
      }

      // Only generated on the create-new/reactivate branches below (never
      // on the "still ACTIVE" refresh above) to bound AI spend — an
      // enrichment on top of the deterministic alert, never blocking it.
      const mitigationSuggestions = await generateMitigationSuggestions(organizationId, result);

      if (existing) {
        await prisma.alert.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            severity: result.severity,
            title: result.title,
            message: result.message,
            metricValue: result.metricValue,
            thresholdValue: result.thresholdValue,
            formula: result.formula,
            mitigationSuggestions,
            triggeredAt: new Date(),
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            resolvedAt: null,
          },
        });
      } else {
        await prisma.alert.create({
          data: {
            organizationId,
            type,
            severity: result.severity,
            status: "ACTIVE",
            title: result.title,
            message: result.message,
            relatedEntityType: result.relatedEntityType ?? null,
            relatedEntityId,
            metricValue: result.metricValue,
            thresholdValue: result.thresholdValue,
            formula: result.formula,
            mitigationSuggestions,
          },
        });
      }

      await notifyOrganizationOwners({
        organizationId,
        type: "CRITICAL_ALERT",
        title: result.title,
        message: result.message,
      });
      await emailOrganizationOwners({
        organizationId,
        subject: result.title,
        text: `${result.message}\n\nFormula: ${result.formula}`,
      });
    }
  }
}
