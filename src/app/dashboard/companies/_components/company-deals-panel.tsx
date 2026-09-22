import Link from "next/link";
import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/app/dashboard/_lib/format";

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

const PRIORITY_VARIANT: Record<Priority, "outline" | "secondary" | "accent" | "default"> = {
  LOW: "outline",
  NORMAL: "secondary",
  HIGH: "accent",
  URGENT: "default",
};

export interface CompanyDealRow {
  id: string;
  name: string;
  value: number | null;
  probability: number | null;
  stageName: string;
  expectedCloseDate: string | null;
  ownerName: string | null;
  priority: string;
}

/**
 * The real CRM pipeline entity for this company — distinct from the legacy
 * `Lead[]` list shown elsewhere on this page, which predates the Deal
 * pipeline and isn't kept in sync with deal stage/value.
 */
export function CompanyDealsPanel({ deals }: { deals: CompanyDealRow[] }) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" /> Deals ({deals.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 pt-0">
        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground">No deals in the pipeline for this company yet.</p>
        ) : (
          deals.map((deal) => {
            const priority = (deal.priority as Priority) in PRIORITY_VARIANT ? (deal.priority as Priority) : "NORMAL";
            return (
              <Link
                key={deal.id}
                href={`/dashboard/crm/deals/${deal.id}`}
                className="flex flex-col gap-1 rounded-lg border border-border/60 p-2.5 text-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{deal.name}</span>
                  <Badge variant="outline">{deal.stageName}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {deal.value != null && <span>{formatCurrency(deal.value)}</span>}
                  {deal.probability != null && <span>{deal.probability}% likely</span>}
                  {deal.expectedCloseDate && <span>Close {new Date(deal.expectedCloseDate).toLocaleDateString()}</span>}
                  {deal.ownerName && <span>Owner: {deal.ownerName}</span>}
                  <Badge variant={PRIORITY_VARIANT[priority]} className={priority === "NORMAL" ? "opacity-60" : ""}>
                    {priority}
                  </Badge>
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
