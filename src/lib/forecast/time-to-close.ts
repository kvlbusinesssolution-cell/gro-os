import { prisma } from "@/lib/prisma";
import { getSalesForecast } from "@/app/dashboard/crm/_lib/forecast";

export interface TimeToCloseResult {
  predictedDays: number | null;
  predictedCloseDate: string | null;
  method: string;
  insufficientData: boolean;
}

/**
 * §19 — PREDICTED time-to-close, never presented as confirmed. Reuses
 * getSalesForecast's real avgSalesCycleDays (avoids re-deriving the same
 * Won-deal cycle-length calculation) rather than inventing a second one.
 */
export async function predictTimeToClose(dealId: string, asOf: Date = new Date()): Promise<TimeToCloseResult> {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId }, select: { organizationId: true, createdAt: true } });
  const forecast = await getSalesForecast(deal.organizationId);

  if (forecast.avgSalesCycleDays === null) {
    return { predictedDays: null, predictedCloseDate: null, method: "INSUFFICIENT_HISTORICAL_DATA — no real Won deal with a computable sales-cycle length exists yet.", insufficientData: true };
  }

  const ageDays = Math.round((asOf.getTime() - deal.createdAt.getTime()) / 86_400_000);
  const remainingDays = Math.max(0, Math.round(forecast.avgSalesCycleDays - ageDays));
  const predictedCloseDate = new Date(asOf.getTime() + remainingDays * 86_400_000).toISOString();

  return {
    predictedDays: remainingDays,
    predictedCloseDate,
    method: `Historical average sales cycle (${Math.round(forecast.avgSalesCycleDays)} days, from real Won deals) minus this deal's current age (${ageDays} days).`,
    insufficientData: false,
  };
}
