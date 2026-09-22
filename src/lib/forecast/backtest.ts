import { prisma } from "@/lib/prisma";
import { FORECAST_CONFIG } from "./config";

export interface BacktestResult {
  cutoffDate: string;
  sampleSize: number;
  predictedWinRate: number | null;
  actualWinRate: number | null;
  error: number | null;
  insufficientData: boolean;
  limitation: string;
}

/**
 * §54 — Backtesting, with an important, documented honesty constraint.
 *
 * Deal only stores its CURRENT stage — there is no historical record of
 * when a deal actually reached Won/Lost before Phase 12 shipped
 * (DealStageHistory only starts logging from now on). Trusting "the deal
 * is CURRENTLY Won/Lost" as if that were true AT a past cutoff date would
 * be exactly the future-information leakage §9/§18 forbid: a deal open at
 * the cutoff but won weeks later would incorrectly count as a same-day
 * "closed" data point.
 *
 * So this function ONLY counts a deal as "closed by cutoffDate" when a
 * REAL DealStageHistory row proves it reached Won/Lost at or before that
 * timestamp. Since that log starts empty, every backtest against a date
 * before this shipped will honestly return INSUFFICIENT_DATA — this is
 * correct behavior, not a bug, and is expected to keep returning
 * INSUFFICIENT_DATA until real stage-transition history accumulates over
 * the following weeks/months.
 */
export async function runBacktest(organizationId: string, cutoffDate: Date): Promise<BacktestResult> {
  const closedByHistory = await prisma.dealStageHistory.findMany({
    where: { organizationId, toStageName: { in: ["Won", "Lost"] }, changedAt: { lte: cutoffDate } },
    orderBy: { changedAt: "asc" },
    distinct: ["dealId"],
  });

  const limitation =
    "Deal has no stage-transition history before Phase 12 shipped, so a deal's CURRENT stage cannot be trusted as true at a past cutoff date without risking future-information leakage. Only DealStageHistory-verified closures count here — this will report INSUFFICIENT_DATA for any cutoff before real transition history accumulated.";

  if (closedByHistory.length < FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE) {
    return { cutoffDate: cutoffDate.toISOString(), sampleSize: closedByHistory.length, predictedWinRate: null, actualWinRate: null, error: null, insufficientData: true, limitation };
  }

  const dealIds = closedByHistory.map((h) => h.dealId);
  const deals = await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, createdAt: true, dealStage: { select: { name: true } } } });
  const wonCount = deals.filter((d) => d.dealStage.name === "Won").length;
  const actualWinRate = wonCount / deals.length;

  // Predicted: the org-wide baseline win rate computed from deals that were
  // ALREADY closed (by the same DealStageHistory-verified standard) before
  // this cohort's own creation window began — a real, leakage-safe
  // train/evaluate split (§18), not the live baseline.
  const earliestInCohort = deals.reduce((min, d) => (d.createdAt < min ? d.createdAt : min), deals[0]!.createdAt);
  const priorClosures = await prisma.dealStageHistory.findMany({
    where: { organizationId, toStageName: { in: ["Won", "Lost"] }, changedAt: { lt: earliestInCohort } },
    distinct: ["dealId"],
    select: { dealId: true },
  });
  if (priorClosures.length < FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE) {
    return { cutoffDate: cutoffDate.toISOString(), sampleSize: deals.length, predictedWinRate: null, actualWinRate, error: null, insufficientData: true, limitation: `${limitation} (${priorClosures.length} prior-verified closures exist — not enough for a leakage-safe training baseline.)` };
  }
  const priorDeals = await prisma.deal.findMany({ where: { id: { in: priorClosures.map((c) => c.dealId) } }, select: { dealStage: { select: { name: true } } } });
  const predictedWinRate = priorDeals.filter((d) => d.dealStage.name === "Won").length / priorDeals.length;

  return { cutoffDate: cutoffDate.toISOString(), sampleSize: deals.length, predictedWinRate, actualWinRate, error: Math.abs(predictedWinRate - actualWinRate), insufficientData: false, limitation };
}
