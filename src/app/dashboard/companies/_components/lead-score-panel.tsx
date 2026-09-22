"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LeadScoreBadge } from "@/app/dashboard/_components/lead-score-badge";
import { rescoreCompany } from "../_lib/intelligence-actions";
import type { LeadScoreBand } from "@/generated/prisma/client";

export interface LeadScorePanelProps {
  companyId: string;
  score: {
    overallScore: number;
    band: LeadScoreBand;
    industryMatchScore: number;
    companySizeScore: number;
    growthScore: number;
    technologyFitScore: number;
    opportunitySizeScore: number;
    budgetPotentialScore: number;
    locationScore: number;
    digitalMaturityScore: number;
    automationNeedScore: number;
    scoredAt: string;
  } | null;
}

const SUB_SCORES: Array<{ key: keyof NonNullable<LeadScorePanelProps["score"]>; label: string; strongLabel: string; weakLabel: string }> = [
  { key: "industryMatchScore", label: "Industry match", strongLabel: "strong industry match", weakLabel: "industry match is moderate" },
  { key: "companySizeScore", label: "Company size", strongLabel: "a strong-fit company size", weakLabel: "company size fit is moderate" },
  { key: "growthScore", label: "Growth", strongLabel: "strong growth", weakLabel: "growth signals are weak" },
  { key: "technologyFitScore", label: "Technology fit", strongLabel: "strong technology fit", weakLabel: "technology fit is moderate" },
  { key: "opportunitySizeScore", label: "Opportunity size", strongLabel: "a large opportunity size", weakLabel: "opportunity size is modest" },
  { key: "budgetPotentialScore", label: "Budget potential", strongLabel: "strong budget potential", weakLabel: "budget potential is lower" },
  { key: "locationScore", label: "Location match", strongLabel: "a strong location match", weakLabel: "location match is moderate" },
  { key: "digitalMaturityScore", label: "Digital maturity", strongLabel: "high digital maturity", weakLabel: "digital maturity is low" },
  { key: "automationNeedScore", label: "Automation need", strongLabel: "clear automation need", weakLabel: "automation need is unclear" },
];

/**
 * One-sentence "why this score" narrative — same dominant-strengths/
 * weakest-factor pattern as opportunity-priority.ts's dominantFactors/
 * weakestFactor, adapted to LeadScore's 9 sub-scores. Purely a function of
 * the sub-scores already passed in as props (deterministic, no clock/RNG),
 * so it's safe to compute directly during render.
 */
function leadScoreNarrative(score: NonNullable<LeadScorePanelProps["score"]>): string {
  const factors = SUB_SCORES.map(({ key, strongLabel, weakLabel }) => ({
    value: score[key] as number,
    strongLabel: `${strongLabel} (${score[key]})`,
    weakLabel: `${weakLabel} (${score[key]})`,
  }));

  const strengths = factors
    .filter((f) => f.value >= 70)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((f) => f.strongLabel);
  const weakest = factors.sort((a, b) => a.value - b.value)[0].weakLabel;

  const bandLabel = `${score.band.charAt(0)}${score.band.slice(1).toLowerCase()} lead`;
  return strengths.length > 0
    ? `${bandLabel} (score ${score.overallScore}) — ${strengths.join(" and ")}, though ${weakest}.`
    : `${bandLabel} (score ${score.overallScore}) — no single factor is particularly strong; ${weakest}.`;
}

export function LeadScorePanel({ companyId, score }: LeadScorePanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleRescore() {
    startTransition(async () => {
      await rescoreCompany(companyId);
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          Lead score
          {score && <LeadScoreBadge band={score.band} score={score.overallScore} />}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={handleRescore} disabled={pending}>
          <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
          {pending ? "Scoring…" : "Rescore"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {!score ? (
          <p className="text-xs text-muted-foreground">Not scored yet. Click Rescore to compute a deterministic lead score.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{leadScoreNarrative(score)}</p>
            {SUB_SCORES.map(({ key, label }) => {
              const value = score[key] as number;
              return (
                <div key={key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-muted-foreground">{value}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(value, value > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">
              Computed deterministically from stored data — last scored {new Date(score.scoredAt).toLocaleString()}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
