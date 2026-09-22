import { ArrowRight, History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface IntentHistoryEntryView {
  previousScore: number | null;
  newScore: number;
  scoreChange: number;
  previousBand: string | null;
  newBand: string;
  previousStage: string | null;
  newStage: string;
  reason: string;
  triggerSignal: string | null;
  calculatedAt: string;
}

/**
 * Phase 2 (Buying Intent Intelligence Engine) — real, append-only score/
 * stage change history (IntentScoreHistory, written only when
 * computeIntentScore finds a genuine change — never on a no-op recompute).
 * Oldest first, exactly as stored; nothing here is ever overwritten.
 */
export function CompanyIntentHistoryPanel({ history }: { history: IntentHistoryEntryView[] }) {
  if (history.length === 0) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> Intent history
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">No intent changes recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" /> Intent history ({history.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-1 border-l-2 border-border pl-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              {entry.previousScore !== null ? (
                <>
                  {entry.previousScore}
                  <ArrowRight className="size-3" />
                  {entry.newScore}
                </>
              ) : (
                <>Initial score: {entry.newScore}</>
              )}
              {entry.previousStage !== entry.newStage && (
                <span className="text-muted-foreground">
                  ({entry.previousStage ?? "—"} <ArrowRight className="inline size-3" /> {entry.newStage})
                </span>
              )}
            </div>
            <p className="text-muted-foreground">{entry.reason}</p>
            <p className="text-[11px] text-muted-foreground">{new Date(entry.calculatedAt).toLocaleString()}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
