import { getPipelineHealthScore } from "@/lib/pipeline/intelligence";
import { computePredictedPipeline } from "./pipeline";
import type { DealRiskLevel } from "./types";

export interface PipelineConcentration {
  top1Share: number | null;
  top3Share: number | null;
  top10Share: number | null;
}

export interface PipelineRiskAssessment {
  riskLevel: DealRiskLevel;
  concentration: PipelineConcentration;
  stalledRatio: number;
  stageBalance: number;
  reasons: Array<{ reason: string; evidence: string }>;
  topDealIds: string[];
}

/**
 * §22/§23 — analyzes the whole open pipeline, reusing
 * getPipelineHealthScore (src/lib/pipeline/intelligence.ts, real
 * stageBalance/stalledRatio) rather than re-deriving those, and the new
 * calibrated weighted pipeline (pipeline.ts) for concentration — never a
 * single hidden aggregate number (§23: "do not hide concentration risk
 * inside one aggregate forecast number").
 */
export async function computePipelineRisk(organizationId: string, asOf: Date = new Date()): Promise<PipelineRiskAssessment> {
  const [health, pipeline] = await Promise.all([getPipelineHealthScore(organizationId), computePredictedPipeline(organizationId, asOf)]);

  const weighted = pipeline.lines.filter((l) => l.expectedValue !== null).sort((a, b) => b.expectedValue! - a.expectedValue!);
  const totalWeighted = weighted.reduce((sum, l) => sum + l.expectedValue!, 0);

  const shareOf = (n: number) => (totalWeighted > 0 ? weighted.slice(0, n).reduce((sum, l) => sum + l.expectedValue!, 0) / totalWeighted : null);

  const concentration: PipelineConcentration = {
    top1Share: weighted.length >= 1 ? shareOf(1) : null,
    top3Share: weighted.length >= 3 ? shareOf(3) : null,
    top10Share: weighted.length >= 10 ? shareOf(10) : null,
  };

  const reasons: Array<{ reason: string; evidence: string }> = [];
  if (concentration.top1Share !== null && concentration.top1Share > 0.4) {
    reasons.push({ reason: "Single deal dominates expected revenue", evidence: `${weighted[0]!.dealName} alone is ${Math.round(concentration.top1Share * 100)}% of weighted pipeline.` });
  }
  if (concentration.top3Share !== null && concentration.top3Share > 0.6) {
    reasons.push({ reason: "Top 3 deals dominate expected revenue", evidence: `Top 3 deals are ${Math.round(concentration.top3Share * 100)}% of weighted pipeline: ${weighted.slice(0, 3).map((l) => l.dealName).join(", ")}.` });
  }
  if (health.stalledRatio > 0.3) {
    reasons.push({ reason: "High share of stalled deals", evidence: `${Math.round(health.stalledRatio * 100)}% of open deals are past their expected close date.` });
  }
  if (health.stageBalance < 0.4) {
    reasons.push({ reason: "Pipeline concentrated in too few stages", evidence: `Stage balance score ${Math.round(health.stageBalance * 100)}/100 — deals are bottlenecked rather than spread across the pipeline.` });
  }
  if (pipeline.openDealsCount > 0 && pipeline.openDealsCount < 5) {
    reasons.push({ reason: "Too few open opportunities", evidence: `Only ${pipeline.openDealsCount} open deal(s) — a single loss materially changes the forecast.` });
  }

  const riskLevel: DealRiskLevel = pipeline.openDealsCount === 0 ? "UNKNOWN" : reasons.length >= 3 ? "CRITICAL" : reasons.length >= 2 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW";

  return { riskLevel, concentration, stalledRatio: health.stalledRatio, stageBalance: health.stageBalance, reasons, topDealIds: weighted.slice(0, 3).map((l) => l.dealId) };
}
