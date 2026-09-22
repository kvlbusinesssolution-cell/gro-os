import Link from "next/link";
import { TrendingUp, Wallet, ShieldAlert, Target, BarChart3 } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../_lib/require-membership";
import { getForecastOverview } from "@/lib/forecast/queries";

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const CONFIDENCE_BADGE: Record<string, "accent" | "secondary" | "outline"> = { HIGH: "accent", MEDIUM: "secondary", LOW: "outline" };

export default async function ForecastOverviewPage() {
  const { membership } = await requireActiveMembership("/dashboard/forecast");
  const overview = await getForecastOverview(membership.organizationId);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <TrendingUp className="size-6 text-primary" /> Predictive Revenue Engine
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Predictions, not facts. Every number below is either an ACTUAL figure from real CRM records, or a
            PREDICTION/FORECAST clearly labeled with its confidence, data cutoff, and method — never presented as a
            guaranteed outcome.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Wallet className="size-3.5" /> Pipeline (ACTUAL)
              </span>
              <span className="text-xl font-semibold text-foreground">{formatCurrency(overview.pipelineSnapshot?.predictionValue)}</span>
              <span className="text-[11px] text-muted-foreground">Real sum of open deal values</span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Target className="size-3.5" /> Weighted Pipeline (PREDICTED)
              </span>
              <span className="text-xl font-semibold text-foreground">{formatCurrency(overview.weightedSnapshot?.predictionValue)}</span>
              {overview.weightedSnapshot && <Badge variant={CONFIDENCE_BADGE[overview.weightedSnapshot.confidence] ?? "outline"}>{overview.weightedSnapshot.confidence}</Badge>}
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] text-muted-foreground">This Month (FORECAST)</span>
              <span className="text-xl font-semibold text-foreground">{formatCurrency(overview.monthly.forecastTotal)}</span>
              <span className="text-[11px] text-muted-foreground">
                {overview.monthly.rangeAvailable ? `${formatCurrency(overview.monthly.lowerBound)} – ${formatCurrency(overview.monthly.upperBound)}` : "Range not available"}
              </span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldAlert className="size-3.5" /> High-Risk Deals
              </span>
              <span className="text-xl font-semibold text-foreground">{overview.highRiskDealsCount}</span>
              <span className="text-[11px] text-muted-foreground">{overview.stalledCount} stalled (14+ days past expected close)</span>
            </CardContent>
          </Card>
        </div>

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-4">
            <span className="text-sm font-medium text-foreground">This month — {overview.monthly.periodLabel}</span>
            <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
              <span>Actual: <strong className="text-foreground">{formatCurrency(overview.monthly.actualRevenue)}</strong></span>
              <span>Expected future: <strong className="text-foreground">{formatCurrency(overview.monthly.expectedFutureRevenue)}</strong></span>
              <span>Recurring: <strong className="text-foreground">{formatCurrency(overview.monthly.recurringContribution)}</strong></span>
            </div>
            <p className="text-[11px] text-muted-foreground">{overview.monthly.method}</p>
          </CardContent>
        </Card>

        {overview.calibration && (
          <Card glass>
            <CardContent className="flex flex-col gap-1 p-4">
              <span className="text-sm font-medium text-foreground">Deal probability calibration</span>
              <Badge variant="outline" className="w-fit">{overview.calibration.verdict}</Badge>
              <p className="text-xs text-muted-foreground">{overview.calibration.summary}</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Link href="/dashboard/forecast/pipeline">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-sm font-medium text-foreground">Pipeline &amp; Deals</span>
                <span className="text-xs text-muted-foreground">Every open deal, calibrated probability, expected value.</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/forecast/revenue">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-sm font-medium text-foreground">Monthly &amp; Quarterly Forecast</span>
                <span className="text-xs text-muted-foreground">Actual vs expected vs forecast, by real calendar period.</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/forecast/risk">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-sm font-medium text-foreground">Deal &amp; Pipeline Risk</span>
                <span className="text-xs text-muted-foreground">Every risk level has cited, real evidence.</span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/forecast/accuracy">
            <Card glass className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <BarChart3 className="size-4 text-primary" /> Accuracy &amp; Calibration
                </span>
                <span className="text-xs text-muted-foreground">Predicted vs actual, once deals close.</span>
              </CardContent>
            </Card>
          </Link>
        </div>
      </Container>
    </main>
  );
}
