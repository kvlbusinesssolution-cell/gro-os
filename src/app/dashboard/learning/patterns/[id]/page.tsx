import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { getPatternWithEvidence } from "@/lib/learning/queries";

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function LearningPatternDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/learning/patterns/${id}`);
  const result = await getPatternWithEvidence(membership.organizationId, id);
  if (!result) notFound();
  const { pattern, evidence } = result;
  const factors = pattern.confidenceFactors as Record<string, number>;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/learning/patterns" className="text-xs text-muted-foreground hover:text-foreground">
            ← All patterns
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Sparkles className="size-6 text-primary" /> {pattern.name}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{pattern.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card glass>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-[11px] text-muted-foreground">Sample Size</span>
              <span className="text-xl font-semibold text-foreground">{pattern.sampleSize}</span>
              <span className="text-[11px] text-muted-foreground">{pattern.positiveOutcomes} won / {pattern.negativeOutcomes} lost</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-[11px] text-muted-foreground">Conversion Rate</span>
              <span className="text-xl font-semibold text-foreground">{pattern.conversionRate !== null ? `${Math.round(pattern.conversionRate * 100)}%` : "—"}</span>
              <span className="text-[11px] text-muted-foreground">of decided (won+lost) outcomes</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-[11px] text-muted-foreground">Revenue</span>
              <span className="text-xl font-semibold text-foreground">{formatCurrency(pattern.revenue)}</span>
              <span className="text-[11px] text-muted-foreground">Avg deal {formatCurrency(pattern.avgDealSize)}</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-[11px] text-muted-foreground">Sales Cycle</span>
              <span className="text-xl font-semibold text-foreground">{pattern.avgSalesCycleDays !== null ? `${Math.round(pattern.avgSalesCycleDays)}d` : "—"}</span>
              <span className="text-[11px] text-muted-foreground">median {pattern.medianSalesCycleDays !== null ? `${Math.round(pattern.medianSalesCycleDays)}d` : "—"}</span>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Sample: {pattern.sampleClassification.replace(/_/g, " ")}</Badge>
          <Badge variant="outline">Confidence: {pattern.confidence}</Badge>
          <Badge variant="outline">Status: {pattern.status}</Badge>
          <Badge variant="outline">Causality: {pattern.causality}</Badge>
          <Badge variant="outline">
            {pattern.timePeriodStart.toLocaleDateString("en-IN")} – {pattern.timePeriodEnd.toLocaleDateString("en-IN")}
          </Badge>
        </div>

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-4">
            <span className="text-sm font-medium text-foreground">Confidence factors (real, computed — never AI-generated)</span>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
              <span>Sample size: {Math.round((factors?.sampleSize ?? 0) * 100)}%</span>
              <span>Outcome consistency: {Math.round((factors?.outcomeConsistency ?? 0) * 100)}%</span>
              <span>Time stability: {Math.round((factors?.timeStability ?? 0) * 100)}%</span>
              <span>Data completeness: {Math.round((factors?.dataCompleteness ?? 0) * 100)}%</span>
              <span>Cross-cohort stability: {Math.round((factors?.crossCohortStability ?? 0) * 100)}%</span>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Evidence — {evidence.length} real observation(s)</h2>
          {evidence.length === 0 ? (
            <p className="text-xs text-muted-foreground">No linked observations found (they may have been superseded by a more recent learning run).</p>
          ) : (
            <Card glass>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Records</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evidence.map((e) => (
                      <TableRow key={e.observationId}>
                        <TableCell>
                          {e.company ? (
                            <Link href={`/dashboard/companies/${e.company.id}`} className="font-medium text-foreground hover:underline">
                              {e.company.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.outcome}</Badge>
                        </TableCell>
                        <TableCell>{formatCurrency(e.revenue)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[e.dealId && "deal", e.proposalId && "proposal", e.meetingId && "meeting"].filter(Boolean).join(", ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </Container>
    </main>
  );
}
