import { CalendarRange } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { computeMonthlyForecast, computeQuarterlyForecast, type PeriodForecast } from "@/lib/forecast/revenue-forecast";

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const CONFIDENCE_BADGE: Record<string, "accent" | "secondary" | "outline"> = { HIGH: "accent", MEDIUM: "secondary", LOW: "outline" };

function PeriodCard({ period }: { period: PeriodForecast }) {
  return (
    <Card glass>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{period.periodLabel}</span>
          <Badge variant={CONFIDENCE_BADGE[period.confidence] ?? "outline"}>{period.confidence} confidence</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Actual</p>
            <p className="font-medium text-foreground">{formatCurrency(period.actualRevenue)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Expected future</p>
            <p className="font-medium text-foreground">{formatCurrency(period.expectedFutureRevenue)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Recurring</p>
            <p className="font-medium text-foreground">{formatCurrency(period.recurringContribution)}</p>
          </div>
        </div>
        <div className="border-t border-border/50 pt-2">
          <p className="text-xs text-muted-foreground">Forecast Total (PREDICTED)</p>
          <p className="text-lg font-semibold text-foreground">{formatCurrency(period.forecastTotal)}</p>
          <p className="text-xs text-muted-foreground">{period.rangeAvailable ? `Range: ${formatCurrency(period.lowerBound)} – ${formatCurrency(period.upperBound)}` : "FORECAST RANGE NOT AVAILABLE — not enough deal probability spread to compute one."}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">{period.method}</p>
        <p className="text-[11px] text-muted-foreground">{period.expectedClosuresCount} open deal(s) with an expectedCloseDate in this period. {!period.dataSufficient && "Data insufficient for a meaningful forecast."}</p>
      </CardContent>
    </Card>
  );
}

export default async function ForecastRevenuePage() {
  const { membership } = await requireActiveMembership("/dashboard/forecast/revenue");
  const orgId = membership.organizationId;

  const [thisMonth, nextMonth, thisQuarter, nextQuarter] = await Promise.all([
    computeMonthlyForecast(orgId, 0),
    computeMonthlyForecast(orgId, 1),
    computeQuarterlyForecast(orgId, 0),
    computeQuarterlyForecast(orgId, 1),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <CalendarRange className="size-6 text-primary" /> Monthly &amp; Quarterly Forecast
          </h1>
          <p className="text-sm text-muted-foreground">Actual revenue and predicted future revenue are always shown separately, never blended into one unlabeled number.</p>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PeriodCard period={thisMonth} />
            <PeriodCard period={nextMonth} />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quarterly</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PeriodCard period={thisQuarter} />
            <PeriodCard period={nextQuarter} />
          </div>
        </div>
      </Container>
    </main>
  );
}
