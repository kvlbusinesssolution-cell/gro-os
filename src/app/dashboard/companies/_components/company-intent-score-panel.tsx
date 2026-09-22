import Link from "next/link";
import { Minus, TrendingDown, TrendingUp, Zap, ShieldQuestion } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IntentBand, BuyingStage } from "@/generated/prisma/client";

export interface IntentSignalView {
  signal: string;
  source:
    | "growthSignals"
    | "hiringSignals"
    | "expansionIndicators"
    | "companyEvidence"
    | "emailEngagement"
    | "replyEngagement"
    | "meetingActivity"
    | "proposalActivity";
  detail: string;
  points: number;
}

export interface CompanyIntentScoreView {
  score: number;
  band: IntentBand;
  signals: IntentSignalView[];
  reasoning: string;
  scoredAt: string;
  buyingStage: BuyingStage;
  buyingStageReasoning: string;
  buyingStageConfidence: number;
}

const STAGE_LABEL: Record<BuyingStage, string> = {
  UNKNOWN: "Unknown",
  TARGET: "Target",
  AWARENESS: "Awareness",
  CONSIDERATION: "Consideration",
  DECISION: "Decision",
  NEGOTIATION: "Negotiation",
  CUSTOMER: "Customer",
  LOST: "Lost",
};

const BAND_STYLE: Record<IntentBand, { label: string; icon: typeof Zap; className: string }> = {
  HIGH: { label: "High intent", icon: Zap, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  MEDIUM: { label: "Medium intent", icon: TrendingUp, className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  LOW: { label: "Low intent", icon: TrendingDown, className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  NONE: { label: "No signal", icon: Minus, className: "border-border bg-muted text-muted-foreground" },
};

/**
 * Buying-intent explainability — deterministic score computed once by
 * computeIntentScore (src/lib/business-development/intent-scoring.ts) and
 * stored on IntentScore, never recomputed or re-derived here. `reasoning`
 * is already a real, AI-authored sentence on that row, rendered verbatim.
 */
export function CompanyIntentScorePanel({ intentScore }: { intentScore: CompanyIntentScoreView | null }) {
  return (
    <Card glass>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          Buying intent
          {intentScore && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                BAND_STYLE[intentScore.band].className,
              )}
            >
              {(() => {
                const Icon = BAND_STYLE[intentScore.band].icon;
                return <Icon className="size-3" />;
              })()}
              {intentScore.score} · {BAND_STYLE[intentScore.band].label}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {!intentScore ? (
          <p className="text-xs text-muted-foreground">Intent hasn&apos;t been scored for this company yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Buying stage: {STAGE_LABEL[intentScore.buyingStage]}</Badge>
              <span className="text-[11px] text-muted-foreground">{Math.round(intentScore.buyingStageConfidence * 100)}% confidence</span>
            </div>
            <p className="text-xs text-muted-foreground">{intentScore.buyingStageReasoning}</p>
            <p className="text-xs text-muted-foreground">{intentScore.reasoning}</p>
            {intentScore.signals.length > 0 && (
              <div className="flex flex-col gap-2">
                {intentScore.signals.map((s, i) => (
                  <div key={`${s.signal}-${i}`} className="flex items-start justify-between gap-2 text-xs">
                    <div>
                      <p className="font-medium text-foreground">{s.signal}</p>
                      <p className="text-muted-foreground">{s.detail}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                      +{s.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Last scored {new Date(intentScore.scoredAt).toLocaleDateString()}.
            </p>
            <Link href="/dashboard/learning/validation" className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
              <ShieldQuestion className="size-3" /> See how well intent score bands predict real outcomes →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
