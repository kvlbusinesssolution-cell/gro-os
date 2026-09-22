import { prisma } from "@/lib/prisma";
import { DEAL_STALLED_DAYS } from "@/lib/alerts/rules";
import { getSalesForecast } from "@/app/dashboard/crm/_lib/forecast";
import type { DealRiskAssessment, DealRiskLevel, DealRiskReason } from "./types";

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * §21 — Deal Risk, with real per-reason evidence (never invented). Reuses
 * DEAL_STALLED_DAYS (src/lib/alerts/rules.ts) rather than a second
 * threshold, and getSalesForecast's real avgSalesCycleDays rather than a
 * guessed "long cycle" cutoff.
 */
export async function computeDealRisk(dealId: string, asOf: Date = new Date()): Promise<DealRiskAssessment> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      company: { select: { id: true, organizationId: true, intentScore: { select: { band: true } } } },
      contact: { select: { id: true, decisionMakerId: true } },
    },
  });

  const reasons: DealRiskReason[] = [];

  if (!deal.company) {
    return { dealId, riskLevel: "UNKNOWN", reasons: [{ reason: "No company linked", evidence: "This deal has no linked Company — risk signals below require real company/conversation data." }], computedAt: asOf.toISOString() };
  }

  // 1. Stagnation — real time in current stage, from the deal's own
  // DealStageHistory when a real transition has been logged, else the
  // documented updatedAt proxy (same limitation crm/_lib/forecast.ts
  // already carries for sales-cycle length).
  const latestTransition = await prisma.dealStageHistory.findFirst({ where: { dealId }, orderBy: { changedAt: "desc" } });
  const stageEnteredAt = latestTransition?.changedAt ?? deal.updatedAt;
  const daysInStage = daysBetween(stageEnteredAt, asOf);
  if (daysInStage > DEAL_STALLED_DAYS) {
    reasons.push({ reason: "Long time in current stage", evidence: `${daysInStage} day(s) in "${await currentStageName(dealId)}" (threshold: ${DEAL_STALLED_DAYS} days)` });
  }

  // 2. No recent engagement — real Reply from the linked contact.
  if (deal.contact) {
    const lastReply = await prisma.reply.findFirst({ where: { contactId: deal.contact.id }, orderBy: { receivedAt: "desc" } });
    if (!lastReply) {
      reasons.push({ reason: "No recorded reply from this contact", evidence: "No Reply row exists for the deal's linked contact." });
    } else if (daysBetween(lastReply.receivedAt, asOf) > DEAL_STALLED_DAYS) {
      reasons.push({ reason: "No recent engagement", evidence: `Last real reply was ${daysBetween(lastReply.receivedAt, asOf)} day(s) ago (threshold: ${DEAL_STALLED_DAYS} days).` });
    }
  } else {
    reasons.push({ reason: "No contact linked", evidence: "This deal has no linked Contact." });
  }

  // 3. No confirmed decision maker.
  const decisionMakerCount = await prisma.decisionMaker.count({ where: { companyId: deal.company.id } });
  if (!deal.contact?.decisionMakerId && decisionMakerCount === 0) {
    reasons.push({ reason: "No decision maker confirmed", evidence: "Neither the deal's contact nor the company has a linked DecisionMaker record." });
  }

  // 4/5. Real objections + competitor mentions from ConversationIntelligence.
  const convIntel = await prisma.conversationIntelligence.findMany({ where: { companyId: deal.company.id }, select: { objections: true, competitorMentions: true } });
  const objectionCount = convIntel.reduce((sum, ci) => sum + ((ci.objections as unknown as unknown[])?.length ?? 0), 0);
  if (objectionCount > 0) reasons.push({ reason: "Real objections recorded", evidence: `${objectionCount} objection(s) across ${convIntel.length} conversation-intelligence record(s).` });
  const competitorMentionCount = convIntel.reduce((sum, ci) => sum + ((ci.competitorMentions as unknown as unknown[])?.length ?? 0), 0);
  if (competitorMentionCount > 0) reasons.push({ reason: "Competitor mentioned", evidence: `${competitorMentionCount} competitor mention(s) in real conversation records.` });

  // 6. Proposal aging — a real SENT proposal with no resolution.
  const openProposal = await prisma.proposal.findFirst({ where: { dealId }, orderBy: { sentAt: "desc" } });
  if (openProposal?.status === "SENT" && openProposal.sentAt && daysBetween(openProposal.sentAt, asOf) > DEAL_STALLED_DAYS) {
    reasons.push({ reason: "Proposal aging with no resolution", evidence: `Proposal sent ${daysBetween(openProposal.sentAt, asOf)} day(s) ago, still status SENT.` });
  }

  // 7. Low intent.
  if (deal.company.intentScore && (deal.company.intentScore.band === "LOW" || deal.company.intentScore.band === "NONE")) {
    reasons.push({ reason: "Low buying intent", evidence: `IntentScore band = ${deal.company.intentScore.band}.` });
  }

  // 8. Deal age exceeding historical average sales cycle.
  const forecast = await getSalesForecast(deal.organizationId);
  if (forecast.avgSalesCycleDays !== null) {
    const dealAgeDays = daysBetween(deal.createdAt, asOf);
    if (dealAgeDays > forecast.avgSalesCycleDays * 1.5) {
      reasons.push({ reason: "Exceeds historical average sales cycle", evidence: `${dealAgeDays} days open vs. real historical average of ${Math.round(forecast.avgSalesCycleDays)} days.` });
    }
  }

  const riskLevel: DealRiskLevel = reasons.length >= 4 ? "CRITICAL" : reasons.length >= 2 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW";

  return { dealId, riskLevel, reasons, computedAt: asOf.toISOString() };
}

async function currentStageName(dealId: string): Promise<string> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { dealStage: { select: { name: true } } } });
  return deal?.dealStage.name ?? "unknown stage";
}
