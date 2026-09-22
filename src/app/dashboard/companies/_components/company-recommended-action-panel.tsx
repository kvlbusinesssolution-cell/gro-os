import { Target } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface RecommendedActionView {
  hasRecommendation: boolean;
  summary: string;
  decisionMaker: { decisionMaker: { name: string; role: string }; whyThisPerson: string } | null;
  brief: { recommendedService: { label: string } | null; whyThisService: string | null; recommendedNextStep: string | null } | null;
  recommendedChannel: string;
}

/**
 * Phase 2 (Buying Intent Intelligence Engine) §13 — "Recommended Action".
 * A pure display of getIntentRecommendedAction's already-composed result
 * (itself a read-time reuse of buildOpportunityBrief +
 * matchDecisionMakerForOpportunity — no new logic here). This is a
 * RECOMMENDATION only — it never sends anything, and every field shown
 * either has real supporting evidence or an honest fallback.
 */
export function CompanyRecommendedActionPanel({ action }: { action: RecommendedActionView }) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4" /> Recommended action
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {!action.hasRecommendation ? (
          <p className="text-xs text-muted-foreground">{action.summary}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">{action.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {action.brief?.recommendedService && <Badge variant="accent">{action.brief.recommendedService.label}</Badge>}
              <Badge variant="outline">Channel: {action.recommendedChannel}</Badge>
            </div>
            {action.decisionMaker && <p className="text-xs text-muted-foreground">{action.decisionMaker.whyThisPerson}</p>}
            {action.brief?.whyThisService && <p className="text-xs text-muted-foreground">{action.brief.whyThisService}</p>}
            {action.brief?.recommendedNextStep && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Next step: </span>
                {action.brief.recommendedNextStep}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
