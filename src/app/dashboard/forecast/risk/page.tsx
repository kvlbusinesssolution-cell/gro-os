import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getForecastPipelineRisk, listPipelineDeals } from "@/lib/forecast/queries";

const RISK_BADGE: Record<string, "accent" | "secondary" | "outline"> = { LOW: "accent", MEDIUM: "secondary", HIGH: "outline", CRITICAL: "outline", UNKNOWN: "outline" };

export default async function ForecastRiskPage() {
  const { membership } = await requireActiveMembership("/dashboard/forecast/risk");
  const orgId = membership.organizationId;

  const [pipelineRisk, deals] = await Promise.all([getForecastPipelineRisk(orgId), listPipelineDeals(orgId)]);
  const riskyDeals = deals.filter((d) => d.risk && (d.risk.riskLevel === "HIGH" || d.risk.riskLevel === "CRITICAL"));

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <ShieldAlert className="size-6 text-primary" /> Deal &amp; Pipeline Risk
          </h1>
          <p className="text-sm text-muted-foreground">Every risk level below is backed by cited, real evidence — never an unexplained AI score.</p>
        </div>

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Pipeline Risk</span>
              <Badge variant={RISK_BADGE[pipelineRisk.riskLevel] ?? "outline"}>{pipelineRisk.riskLevel}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span>Top 1 deal share: {pipelineRisk.concentration.top1Share !== null ? `${Math.round(pipelineRisk.concentration.top1Share * 100)}%` : "—"}</span>
              <span>Top 3 deal share: {pipelineRisk.concentration.top3Share !== null ? `${Math.round(pipelineRisk.concentration.top3Share * 100)}%` : "—"}</span>
              <span>Stalled ratio: {Math.round(pipelineRisk.stalledRatio * 100)}%</span>
            </div>
            {pipelineRisk.reasons.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                {pipelineRisk.reasons.map((r, i) => (
                  <li key={i}>
                    • <strong className="text-foreground">{r.reason}:</strong> {r.evidence}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">High/Critical Risk Deals ({riskyDeals.length})</h2>
          {riskyDeals.length === 0 ? (
            <Card glass>
              <CardContent className="p-4 text-sm text-muted-foreground">No open deal is currently at HIGH or CRITICAL risk.</CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {riskyDeals.map((d) => (
                <Card glass key={d.dealId}>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                      <Link href={`/dashboard/crm/deals/${d.dealId}`} className="text-sm font-medium text-foreground hover:underline">
                        {d.dealName}
                      </Link>
                      <Badge variant={RISK_BADGE[d.risk!.riskLevel] ?? "outline"}>{d.risk!.riskLevel}</Badge>
                    </div>
                    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {(d.risk!.reasons as Array<{ reason: string; evidence: string }>).map((r, i) => (
                        <li key={i}>
                          • <strong className="text-foreground">{r.reason}:</strong> {r.evidence}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Container>
    </main>
  );
}
