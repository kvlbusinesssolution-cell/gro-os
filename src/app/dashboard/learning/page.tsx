import Link from "next/link";
import { BarChart3, Database, Lightbulb, ShieldQuestion, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../_lib/require-membership";
import { getLearningOverview } from "@/lib/learning/queries";

const HEALTH_BADGE: Record<string, "accent" | "secondary" | "outline" | "default"> = {
  HEALTHY: "accent",
  LIMITED_DATA: "secondary",
  STALE: "outline",
  INSUFFICIENT_DATA: "outline",
  ERROR: "default",
};

export default async function LearningOverviewPage() {
  const { membership } = await requireActiveMembership("/dashboard/learning");
  const overview = await getLearningOverview(membership.organizationId);

  const health = overview.health;
  const totalObservations = health?.totalObservations ?? 0;
  const status = health?.status ?? "INSUFFICIENT_DATA";

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <BarChart3 className="size-6 text-primary" /> Closed-Loop Revenue Learning
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Statistically honest patterns discovered from this org&apos;s own real historical outcomes — Company Found →
            Qualified → Contacted → Replied → Meeting → Proposal → Won/Lost → Revenue. Every pattern shows its real
            sample size, confidence, time period and evidence. Correlation observed — causality not established
            unless a real controlled experiment says otherwise.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] text-muted-foreground">Learning Health</span>
              <Badge variant={HEALTH_BADGE[status] ?? "outline"} className="w-fit">
                {status.replace("_", " ")}
              </Badge>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] text-muted-foreground">Total Observations</span>
              <span className="text-xl font-semibold text-foreground">{totalObservations}</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] text-muted-foreground">Verified Outcomes</span>
              <span className="text-xl font-semibold text-foreground">{health?.verifiedOutcomeCount ?? 0}</span>
              <span className="text-[11px] text-muted-foreground">{health?.unknownOutcomeCount ?? 0} unknown</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] text-muted-foreground">Recommendations Pending</span>
              <span className="text-xl font-semibold text-foreground">{overview.recommendationsPending}</span>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(overview.patternCounts).map(([classification, count]) => (
            <Card glass key={classification}>
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-[11px] text-muted-foreground">{classification.replace("_", " ")}</span>
                <span className="text-lg font-semibold text-foreground">{count as number}</span>
              </CardContent>
            </Card>
          ))}
          {Object.keys(overview.patternCounts).length === 0 && (
            <Card glass className="sm:col-span-2 lg:col-span-5">
              <CardContent className="p-4 text-sm text-muted-foreground">
                No patterns discovered yet — run the learning engine (Settings → Jobs → &quot;Closed-loop revenue
                learning engine&quot; → Run now) once there is enough real outreach/outcome data.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href="/dashboard/learning/patterns">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Sparkles className="size-4 text-primary" /> Patterns
                </span>
                <span className="text-xs text-muted-foreground">Winning/losing patterns, signals, message angles, services, channels, decision makers.</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/learning/validation">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <ShieldQuestion className="size-4 text-primary" /> Intent &amp; Priority Validation
                </span>
                <span className="text-xs text-muted-foreground">Is scoring calibrated? Real false positives/negatives.</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/learning/recommendations">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Lightbulb className="size-4 text-primary" /> Recommendations
                </span>
                <span className="text-xs text-muted-foreground">{overview.recommendationsPending} pending review — nothing auto-applied.</span>
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card glass>
          <CardContent className="flex flex-col gap-3 p-4">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Database className="size-4 text-primary" /> Data Quality
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
              <span>Companies: {overview.dataQuality.counts.companies}</span>
              <span>Lead Opportunities: {overview.dataQuality.counts.leadOpportunities}</span>
              <span>Deals: {overview.dataQuality.counts.deals} ({overview.dataQuality.counts.dealsWon} won)</span>
              <span>Paid Invoices: {overview.dataQuality.counts.invoicesPaid}</span>
              <span>Intent Scores: {overview.dataQuality.counts.intentScores}</span>
              <span>Conversation Intelligence: {overview.dataQuality.counts.conversationIntelligenceRows}</span>
              <span>Replies: {overview.dataQuality.counts.replies}</span>
              <span>Meetings: {overview.dataQuality.counts.outreachMeetings}</span>
            </div>
            {overview.dataQuality.notes.length > 0 && (
              <ul className="flex flex-col gap-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                {overview.dataQuality.notes.map((note, i) => (
                  <li key={i}>• {note}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
