import Link from "next/link";
import { Wallet } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import { listPipelineDeals } from "@/lib/forecast/queries";

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const RISK_BADGE: Record<string, "accent" | "secondary" | "outline"> = { LOW: "accent", MEDIUM: "secondary", HIGH: "outline", CRITICAL: "outline", UNKNOWN: "outline" };

export default async function ForecastPipelinePage() {
  const { membership } = await requireActiveMembership("/dashboard/forecast/pipeline");
  const deals = await listPipelineDeals(membership.organizationId);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Wallet className="size-6 text-primary" /> Pipeline &amp; Deals
          </h1>
          <p className="text-sm text-muted-foreground">
            Every open deal — actual value (real CRM data) and calibrated probability/expected value (PREDICTED, never a
            guarantee).
          </p>
        </div>

        {deals.length === 0 ? (
          <Card glass>
            <CardContent className="p-4 text-sm text-muted-foreground">No open deals right now — pipeline value and weighted pipeline are both real zero, not an error.</CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Value (ACTUAL)</TableHead>
                    <TableHead>Calibrated Probability</TableHead>
                    <TableHead>Expected Value (PREDICTED)</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((d) => (
                    <TableRow key={d.dealId}>
                      <TableCell>
                        <Link href={`/dashboard/crm/deals/${d.dealId}`} className="font-medium text-foreground hover:underline">
                          {d.dealName}
                        </Link>
                        {d.company && <div className="text-xs text-muted-foreground">{d.company.name}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{d.stageName}</Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(d.value)}</TableCell>
                      <TableCell>{d.calibratedProbability !== null ? `${Math.round(d.calibratedProbability * 100)}%` : "Insufficient data"}</TableCell>
                      <TableCell>{formatCurrency(d.expectedValue)}</TableCell>
                      <TableCell>
                        {d.risk ? <Badge variant={RISK_BADGE[d.risk.riskLevel] ?? "outline"}>{d.risk.riskLevel}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}
