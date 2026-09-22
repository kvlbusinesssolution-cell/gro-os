import { Link2, UserCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DECISION_MAKER_ROLE_LABEL } from "@/app/dashboard/opportunities/_lib/opportunity-display";
import type { DecisionMakerRole } from "@/generated/prisma/client";

export interface CompanyDecisionMakerRow {
  id: string;
  name: string;
  role: DecisionMakerRole;
  source: string;
  sourceUrl: string | null;
  confidence: number;
}

/**
 * Real, publicly-sourced named decision-makers at this company — the same
 * data the AI Opportunity Engine's decision-maker matching reads against
 * (see decision-maker-matching.ts). Previously had zero UI anywhere on the
 * company's own page.
 */
export function CompanyDecisionMakersPanel({ decisionMakers }: { decisionMakers: CompanyDecisionMakerRow[] }) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="size-4" /> Decision Makers ({decisionMakers.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 pt-0">
        {decisionMakers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No decision-makers identified yet for this company.</p>
        ) : (
          decisionMakers.map((dm) => (
            <div key={dm.id} className="flex flex-col gap-1 rounded-lg border border-border/60 p-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">{dm.name}</span>
                <Badge variant="outline">{DECISION_MAKER_ROLE_LABEL[dm.role]}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{Math.round(dm.confidence * 100)}% confidence</span>
                {dm.sourceUrl && (
                  <a
                    href={dm.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    <Link2 className="size-3.5" /> {dm.source}
                  </a>
                )}
                {!dm.sourceUrl && <span>{dm.source}</span>}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
