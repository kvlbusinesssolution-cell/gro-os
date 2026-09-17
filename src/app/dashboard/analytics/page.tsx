import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  Bot,
  Filter,
  Building2,
  Flame,
  Globe2,
  Cpu,
  LineChart,
  Radar,
  Layers,
  Wallet,
  CalendarClock,
  Target,
  Grid3x3,
  Boxes,
  MapPin,
  Sparkles,
  RotateCcw,
  Download,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PollRefresher } from "@/components/command-center/poll-refresher";
import { cn } from "@/lib/utils";
import { requireActiveMembership } from "../_lib/require-membership";
import { formatCurrency } from "../_lib/format";
import {
  ensureTodaySnapshot,
  getSnapshotTrend,
  getTaskCompletionTrend,
  getAgentLeaderboard,
  getPipelineFunnel,
  getTaskActivityHeatmap,
  getRevenueByCompany,
} from "@/lib/analytics";
import { computeCompanyHealth } from "@/lib/company-health";
import { getLeadIntelligenceAnalytics } from "@/lib/lead-analytics";
import { getScanAnalytics } from "@/lib/scanner/scan-analytics";
import { getRevenueForecast, getCashFlowProjection, type ForecastHorizon } from "@/lib/revenue/forecast";
import { getCAC, getLTV, getLtvCacRatio } from "@/lib/revenue/cac-ltv";
import { getMRR, getARR, getMonthlyChurnRate } from "@/lib/revenue/subscriptions";
import { computeAcquisitionOverview } from "@/lib/analytics/acquisition-funnel";
import { getAcquisitionInsights } from "@/lib/analytics/acquisition-insights";
import { LineTrend } from "./_components/line-trend";
import { BarTrend } from "./_components/bar-trend";
import { RadarChart } from "./_components/radar-chart";
import { Heatmap } from "./_components/heatmap";
import { Treemap } from "./_components/treemap";
import { GeoWidget } from "./_components/geo-widget";
import { AnalyticsReportExportMenu } from "./_components/analytics-report-export-menu";
import { AcquisitionBreakdownTable } from "./_components/acquisition-breakdown-table";
import { COMPANY_SOURCE_LABEL, barWidthPct, formatDateRangeLabel, maxCount, parseAcquisitionDateRange } from "./_lib/acquisition-display";

const FORECAST_HORIZONS: Array<{ value: ForecastHorizon; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

function isForecastHorizon(value: string | undefined): value is ForecastHorizon {
  return value === "day" || value === "week" || value === "month" || value === "quarter" || value === "year";
}

/**
 * Builds an `/dashboard/analytics` href that preserves whichever of
 * `horizon`/`from`/`to` isn't being changed — the forecast-horizon nav and
 * the Acquisition Overview date-range filter share this one URL, so
 * switching one control must not silently reset the other (mirrors the
 * company-discovery filter form's "one shared query string" convention).
 */
function buildAnalyticsHref(params: { horizon?: string; from?: string; to?: string }): string {
  const sp = new URLSearchParams();
  if (params.horizon) sp.set("horizon", params.horizon);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  const qs = sp.toString();
  return `/dashboard/analytics${qs ? `?${qs}` : ""}`;
}

const BAND_BAR_CLASS: Record<string, string> = {
  HOT: "bg-red-500",
  WARM: "bg-amber-500",
  COLD: "bg-sky-500",
  HIGH: "bg-red-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-sky-500",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string; from?: string; to?: string }>;
}) {
  const { membership } = await requireActiveMembership("/dashboard/analytics");
  const organizationId = membership.organizationId;
  const currency = membership.organization.currency;

  await ensureTodaySnapshot(organizationId);

  const { horizon: horizonParam, from: fromParam, to: toParam } = await searchParams;
  const horizon: ForecastHorizon = isForecastHorizon(horizonParam) ? horizonParam : "month";
  const acquisitionDateRange = parseAcquisitionDateRange(fromParam, toParam);

  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);
  const now = new Date();

  const [
    snapshots,
    taskTrend,
    leaderboard,
    funnel,
    leadIntel,
    scanIntel,
    revenueForecast,
    cashFlow,
    cac,
    ltv,
    mrr,
    arr,
    churnRate,
    companyHealth,
    taskHeatmap,
    revenueByCompany,
    acquisitionOverview,
  ] = await Promise.all([
    getSnapshotTrend(organizationId, 30),
    getTaskCompletionTrend(organizationId, 14),
    getAgentLeaderboard(organizationId),
    getPipelineFunnel(organizationId),
    getLeadIntelligenceAnalytics(organizationId),
    getScanAnalytics(organizationId),
    getRevenueForecast(organizationId, horizon),
    getCashFlowProjection(organizationId, 8),
    getCAC(organizationId, currentMonthStart, now),
    getLTV(organizationId),
    getMRR(organizationId),
    getARR(organizationId),
    getMonthlyChurnRate(organizationId, now),
    computeCompanyHealth(organizationId),
    getTaskActivityHeatmap(organizationId, now),
    getRevenueByCompany(organizationId),
    computeAcquisitionOverview(organizationId, acquisitionDateRange),
  ]);

  // Narration is computed from the already-fetched `acquisitionOverview`
  // above (getAcquisitionInsights makes zero Prisma queries of its own —
  // see acquisition-insights.ts), so it has to run after the Promise.all,
  // not inside it.
  const acquisitionInsights = await getAcquisitionInsights(organizationId, acquisitionOverview);

  const healthAxes = [
    { label: "Business", value: companyHealth.business },
    { label: "Sales", value: companyHealth.sales },
    { label: "Marketing", value: companyHealth.marketing },
    { label: "CRM", value: companyHealth.crm },
    { label: "Automation", value: companyHealth.automation },
    { label: "Revenue", value: companyHealth.revenue },
    { label: "Security", value: companyHealth.security },
    { label: "AI", value: companyHealth.ai },
  ];

  const ltvCacRatio = getLtvCacRatio(ltv.ltv, cac.cac).ratio;

  const maxFunnel = Math.max(1, ...funnel.map((s) => s.count));
  const maxLeaderboard = Math.max(1, ...leaderboard.map((a) => a.completedTasksCount));
  const maxIndustry = Math.max(1, ...leadIntel.topIndustries.map((i) => i.count));
  const maxBand = Math.max(1, ...leadIntel.leadDistribution.map((b) => b.count));
  const maxCountry = Math.max(1, ...leadIntel.countryDistribution.map((c) => c.count));
  const maxTech = Math.max(1, ...leadIntel.technologyTrends.map((t) => t.count));
  const maxScanBand = Math.max(1, ...scanIntel.bandDistribution.map((b) => b.count));
  const maxScanCategory = Math.max(1, ...scanIntel.topRecommendedCategories.map((c) => c.count));
  const maxAcqFunnel = maxCount(acquisitionOverview.funnel.map((s) => s.count));
  const acquisitionRangeLabel = formatDateRangeLabel(acquisitionDateRange);

  return (
    <main className="py-8">
      <PollRefresher />
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Real cross-org trends — Company Health and revenue are tracked daily starting today, so the trend
            lines below grow richer the longer you use GrowthOS.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" /> Company Health (30 days)
              </CardTitle>
              <CardDescription>Daily overall score, snapshotted once per day.</CardDescription>
            </CardHeader>
            <CardContent>
              <LineTrend
                points={snapshots.map((s) => ({
                  label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  value: s.companyHealthScore,
                }))}
                formatValue={(v) => `${Math.round(v)}/100`}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" /> Revenue this month (30 days)
              </CardTitle>
              <CardDescription>Won-stage deal value created this calendar month, tracked daily.</CardDescription>
            </CardHeader>
            <CardContent>
              <LineTrend
                points={snapshots.map((s) => ({
                  label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  value: s.revenueMonthToDate,
                }))}
                formatValue={(v) => formatCurrency(v, currency)}
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Recurring Revenue</h2>
          <p className="text-sm text-muted-foreground">
            Real MRR/ARR from manually-logged Subscription rows (see Billing → Subscriptions) — never estimated.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" /> MRR (30 days)
              </CardTitle>
              <CardDescription>
                Current: <span className="font-medium text-foreground">{formatCurrency(mrr, currency)}</span> · Sum of ACTIVE
                subscriptions, normalized to monthly (MONTHLY ÷ 1, QUARTERLY ÷ 3, YEARLY ÷ 12).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineTrend
                points={snapshots.map((s) => ({
                  label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  value: s.mrr,
                }))}
                formatValue={(v) => formatCurrency(v, currency)}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" /> ARR (30 days)
              </CardTitle>
              <CardDescription>
                Current: <span className="font-medium text-foreground">{formatCurrency(arr, currency)}</span> · MRR × 12.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineTrend
                points={snapshots.map((s) => ({
                  label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  value: s.arr,
                }))}
                formatValue={(v) => formatCurrency(v, currency)}
              />
            </CardContent>
          </Card>
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4" /> Churn rate (this month)
            </CardTitle>
            <CardDescription>{churnRate.formula}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-6">
            {churnRate.ratePct == null ? (
              <p className="text-sm text-muted-foreground">Not enough data yet — no subscriptions were active at the start of this month.</p>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground">Churn rate</p>
                <p className="text-xl font-semibold text-foreground">{churnRate.ratePct.toFixed(1)}%</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Cancelled this month</p>
              <p className="text-xl font-semibold text-foreground">{churnRate.cancelledCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active at period start</p>
              <p className="text-xl font-semibold text-foreground">{churnRate.activeAtPeriodStart}</p>
            </div>
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4" /> Task completion (14 days)
            </CardTitle>
            <CardDescription>Real completed-task counts by day.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarTrend bars={taskTrend.map((t) => ({ label: t.label, value: t.completed }))} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="size-4" /> Pipeline funnel
              </CardTitle>
              <CardDescription>Leads per stage, by count.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {funnel.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pipeline stages configured yet.</p>
              ) : (
                funnel.map((stage) => (
                  <div key={stage.stageName} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{stage.stageName}</span>
                      <span className="text-muted-foreground">
                        {stage.count} · {formatCurrency(stage.value, currency)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max((stage.count / maxFunnel) * 100, stage.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4" /> Agent leaderboard
              </CardTitle>
              <CardDescription>Ranked by completed tasks, with average confidence.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active agents yet.</p>
              ) : (
                leaderboard.map((agent) => (
                  <div key={agent.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{agent.name}</span>
                      <span className="text-muted-foreground">
                        {agent.completedTasksCount} tasks
                        {agent.confidenceScore != null ? ` · ${Math.round(agent.confidenceScore)}% confidence` : ""}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max((agent.completedTasksCount / maxLeaderboard) * 100, agent.completedTasksCount > 0 ? 4 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Lead Intelligence</h2>
          <p className="text-sm text-muted-foreground">
            Real counts and sums over your Companies, Lead Scores, and pipeline — nothing here is estimated by AI.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4" /> Top industries
              </CardTitle>
              <CardDescription>Company count by industry.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {leadIntel.topIndustries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No industry data yet.</p>
              ) : (
                leadIntel.topIndustries.map((i) => (
                  <div key={i.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{i.label}</span>
                      <span className="text-muted-foreground">{i.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max((i.count / maxIndustry) * 100, i.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Flame className="size-4" /> Lead distribution
              </CardTitle>
              <CardDescription>Companies by Hot / Warm / Cold score band.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {leadIntel.leadDistribution.every((b) => b.count === 0) ? (
                <p className="text-sm text-muted-foreground">No companies scored yet.</p>
              ) : (
                leadIntel.leadDistribution.map((b) => (
                  <div key={b.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{b.label}</span>
                      <span className="text-muted-foreground">{b.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${BAND_BAR_CLASS[b.label] ?? "bg-primary"}`}
                        style={{ width: `${Math.max((b.count / maxBand) * 100, b.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe2 className="size-4" /> Country distribution
              </CardTitle>
              <CardDescription>Company count by headquarters country.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {leadIntel.countryDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">No headquarters location data yet.</p>
              ) : (
                leadIntel.countryDistribution.map((c) => (
                  <div key={c.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{c.label}</span>
                      <span className="text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max((c.count / maxCountry) * 100, c.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="size-4" /> Technology trends
              </CardTitle>
              <CardDescription>Most common technologies across researched companies.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {leadIntel.technologyTrends.length === 0 ? (
                <p className="text-sm text-muted-foreground">No technology data yet — run AI research on a company.</p>
              ) : (
                leadIntel.technologyTrends.map((t) => (
                  <div key={t.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{t.label}</span>
                      <span className="text-muted-foreground">{t.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max((t.count / maxTech) * 100, t.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="size-4" /> Pipeline forecast
            </CardTitle>
            <CardDescription>{leadIntel.pipelineForecast.formula}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Open pipeline value</p>
              <p className="text-xl font-semibold text-foreground">
                {formatCurrency(leadIntel.pipelineForecast.openPipelineValue, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Score-weighted forecast</p>
              <p className="text-xl font-semibold text-primary">
                {formatCurrency(leadIntel.pipelineForecast.weightedValue, currency)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Website Intelligence</h2>
          <p className="text-sm text-muted-foreground">
            Real counts and averages over your Website Scanner reports — Opportunity bands, top AI-recommended
            software categories, and average scores by dimension.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radar className="size-4" /> Opportunity distribution
              </CardTitle>
              <CardDescription>Scanned websites by opportunity band.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {scanIntel.bandDistribution.every((b) => b.count === 0) ? (
                <p className="text-sm text-muted-foreground">No scans yet.</p>
              ) : (
                scanIntel.bandDistribution.map((b) => (
                  <div key={b.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{b.label}</span>
                      <span className="text-muted-foreground">{b.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${BAND_BAR_CLASS[b.label] ?? "bg-primary"}`}
                        style={{ width: `${Math.max((b.count / maxScanBand) * 100, b.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4" /> Top recommended software
              </CardTitle>
              <CardDescription>Most-recommended categories across all AI Executive Reports.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {scanIntel.topRecommendedCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recommendations generated yet.</p>
              ) : (
                scanIntel.topRecommendedCategories.map((c) => (
                  <div key={c.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{c.label}</span>
                      <span className="text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max((c.count / maxScanCategory) * 100, c.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="size-4" /> Average scores by dimension
              </CardTitle>
              <CardDescription>Averaged across every completed scan.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {scanIntel.avgDimensionScores.every((d) => d.score === 0) ? (
                <p className="text-sm text-muted-foreground">No scans yet.</p>
              ) : (
                scanIntel.avgDimensionScores.map((d) => (
                  <div key={d.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{d.label}</span>
                      <span className="text-muted-foreground">{d.score}/100</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(d.score, d.score > 0 ? 4 : 0)}%` }} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Forecast</h2>
          <p className="text-sm text-muted-foreground">
            Org-wide revenue forecast — real open-deal pipeline plus real active-subscription MRR, no ML model.
          </p>
        </div>

        <Card glass>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4" /> Revenue forecast
              </CardTitle>
              <CardDescription>{revenueForecast.formula}</CardDescription>
            </div>
            <nav className="flex gap-1.5">
              {FORECAST_HORIZONS.map((h) => (
                <Link
                  key={h.value}
                  href={buildAnalyticsHref({ horizon: h.value, from: fromParam, to: toParam })}
                  className={cn(
                    "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    horizon === h.value
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {h.label}
                </Link>
              ))}
            </nav>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!revenueForecast.dataSufficient && (
              <p className="text-sm text-muted-foreground">
                No open deals closing in this window and no active subscriptions yet — figures below are real zeros,
                not placeholders.
              </p>
            )}
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-muted-foreground">Pipeline contribution</p>
                <p className="text-xl font-semibold text-foreground">
                  {formatCurrency(revenueForecast.pipelineContribution, currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recurring contribution</p>
                <p className="text-xl font-semibold text-foreground">
                  {formatCurrency(revenueForecast.recurringContribution, currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total forecast</p>
                <p className="text-xl font-semibold text-primary">{formatCurrency(revenueForecast.total, currency)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expected closures</p>
                <p className="text-xl font-semibold text-foreground">{revenueForecast.expectedClosuresCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Confidence (deterministic)</p>
                <p className="text-xl font-semibold text-foreground">{revenueForecast.confidenceScore}/100</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{revenueForecast.confidenceFormula}</p>
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Cash-flow projection (8 weeks)
            </CardTitle>
            <CardDescription>
              Real invoice due dates (SENT/OVERDUE, amount owed) and subscription renewal dates (ACTIVE), bucketed by week.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cashFlow.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="size-4" /> No invoices due or subscriptions renewing in the next 8 weeks.
              </p>
            ) : (
              <BarTrend bars={cashFlow.map((b) => ({ label: b.periodLabel, value: b.expectedInflow }))} />
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Unit Economics</h2>
          <p className="text-sm text-muted-foreground">
            Real CAC from manually-logged spend and real LTV from won-deal value plus collected subscription
            revenue — never AI-estimated.
          </p>
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4" /> CAC · LTV · LTV:CAC
            </CardTitle>
            <CardDescription>
              {cac.formula} {ltv.formula}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-muted-foreground">CAC (this month)</p>
              {cac.cac == null ? (
                <p className="text-sm text-muted-foreground">Not enough data yet — log marketing/sales spend.</p>
              ) : (
                <p className="text-xl font-semibold text-foreground">{formatCurrency(cac.cac, currency)}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">LTV (all-time, avg per company)</p>
              {ltv.ltv == null ? (
                <p className="text-sm text-muted-foreground">No won deals or subscriptions yet.</p>
              ) : (
                <p className="text-xl font-semibold text-foreground">{formatCurrency(ltv.ltv, currency)}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">LTV:CAC ratio</p>
              {ltvCacRatio == null ? (
                <p className="text-sm text-muted-foreground">Not enough data yet — log marketing/sales spend.</p>
              ) : (
                <p className="text-xl font-semibold text-primary">{ltvCacRatio.toFixed(1)}:1</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Acquisition Overview</h2>
            <p className="text-sm text-muted-foreground">
              Real source-attribution funnel — Company → Qualified Lead → Opportunity → Contact → Outreach Sent →
              Reply → Meeting → Proposal → Won Deal — plus revenue by source, industry, country, and service.
              Nothing here is estimated; the AI Insights card below only narrates the numbers computed here.
            </p>
          </div>
          <a
            href={`/api/export/acquisition?${new URLSearchParams({ ...(fromParam ? { from: fromParam } : {}), ...(toParam ? { to: toParam } : {}) }).toString()}`}
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Download className="size-4" /> Export CSV
          </a>
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/analytics" method="GET">
              <input type="hidden" name="horizon" value={horizon} />
              <div className="flex flex-col gap-1">
                <label htmlFor="acq-from" className="text-xs text-muted-foreground">
                  From
                </label>
                <Input id="acq-from" name="from" type="date" defaultValue={fromParam ?? ""} className="w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="acq-to" className="text-xs text-muted-foreground">
                  To
                </label>
                <Input id="acq-to" name="to" type="date" defaultValue={toParam ?? ""} className="w-40" />
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Apply
              </button>
              <Link
                href={buildAnalyticsHref({ horizon })}
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> All time
              </Link>
              <span className="pb-2.5 text-xs text-muted-foreground">Showing: {acquisitionRangeLabel}</span>
            </form>
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="size-4" /> Acquisition funnel
            </CardTitle>
            <CardDescription>Real counts per stage, {acquisitionRangeLabel.toLowerCase()}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total revenue (Won deals)</p>
              <p className="text-2xl font-semibold text-primary">{formatCurrency(acquisitionOverview.totalRevenue, currency)}</p>
            </div>
            <div className="flex flex-col gap-3">
              {acquisitionOverview.funnel.map((stage) => (
                <div key={stage.stage} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{stage.stage}</span>
                    <span className="text-muted-foreground">{stage.count}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${barWidthPct(stage.count, maxAcqFunnel)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> AI Insights
            </CardTitle>
            <CardDescription>
              AI-narrated summary of the real numbers above (getAcquisitionInsights) — every sentence is grounded in
              the already-computed acquisition data, never a separate AI query of its own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {acquisitionInsights.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI insights available yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {acquisitionInsights.insights.map((insight, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">By Source</CardTitle>
              <CardDescription>Real counts and revenue per Company.source.</CardDescription>
            </CardHeader>
            <CardContent>
              <AcquisitionBreakdownTable
                title="By source"
                rows={acquisitionOverview.bySource.map((r) => ({ ...r, sourceLabel: COMPANY_SOURCE_LABEL[r.source as keyof typeof COMPANY_SOURCE_LABEL] ?? r.source }))}
                filterKey="sourceLabel"
                defaultSortKey="revenue"
                emptyMessage="No companies yet."
                columns={[
                  { key: "sourceLabel", label: "Source" },
                  { key: "companies", label: "Companies", align: "right" },
                  { key: "qualifiedLeads", label: "Qualified", align: "right" },
                  { key: "opportunities", label: "Opps", align: "right" },
                  { key: "meetings", label: "Meetings", align: "right" },
                  { key: "proposals", label: "Proposals", align: "right" },
                  { key: "wonDeals", label: "Won", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue, currency) },
                ]}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">By Industry</CardTitle>
              <CardDescription>Real counts and revenue per Company.industry.</CardDescription>
            </CardHeader>
            <CardContent>
              <AcquisitionBreakdownTable
                title="By industry"
                rows={acquisitionOverview.byIndustry}
                filterKey="industry"
                defaultSortKey="revenue"
                emptyMessage="No industry data yet."
                columns={[
                  { key: "industry", label: "Industry" },
                  { key: "companies", label: "Companies", align: "right" },
                  { key: "wonDeals", label: "Won", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue, currency) },
                ]}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">By Country</CardTitle>
              <CardDescription>Real counts and revenue per Company.headquartersCountry.</CardDescription>
            </CardHeader>
            <CardContent>
              <AcquisitionBreakdownTable
                title="By country"
                rows={acquisitionOverview.byCountry}
                filterKey="country"
                defaultSortKey="revenue"
                emptyMessage="No headquarters location data yet."
                columns={[
                  { key: "country", label: "Country" },
                  { key: "companies", label: "Companies", align: "right" },
                  { key: "wonDeals", label: "Won", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue, currency) },
                ]}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">By Service</CardTitle>
              <CardDescription>Real counts and revenue per recommended KVL service.</CardDescription>
            </CardHeader>
            <CardContent>
              <AcquisitionBreakdownTable
                title="By service"
                rows={acquisitionOverview.byService}
                filterKey="service"
                defaultSortKey="revenue"
                emptyMessage="No AI-recommended services yet."
                columns={[
                  { key: "service", label: "Service" },
                  { key: "opportunities", label: "Opps", align: "right" },
                  { key: "wonDeals", label: "Won", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue, currency) },
                ]}
              />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">By Campaign</CardTitle>
              <CardDescription>Real per-campaign enrollment, outreach, and revenue conversion.</CardDescription>
            </CardHeader>
            <CardContent>
              <AcquisitionBreakdownTable
                title="By campaign"
                rows={acquisitionOverview.byCampaign.map((r) => ({ ...r }))}
                filterKey="campaignName"
                defaultSortKey="revenue"
                emptyMessage="No campaigns yet."
                columns={[
                  { key: "campaignName", label: "Campaign" },
                  { key: "contactsEnrolled", label: "Enrolled", align: "right" },
                  { key: "emailsSent", label: "Sent", align: "right" },
                  { key: "replies", label: "Replies", align: "right" },
                  { key: "meetings", label: "Meetings", align: "right" },
                  { key: "wonDeals", label: "Won", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right", format: (r) => formatCurrency(r.revenue, currency) },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Visual Intelligence</h2>
            <p className="text-sm text-muted-foreground">
              Four more real, dependency-free views on the same underlying data above — nothing here is
              re-estimated, only re-visualized.
            </p>
          </div>
          <AnalyticsReportExportMenu />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radar className="size-4" /> Company Health radar
              </CardTitle>
              <CardDescription>The 8 real Company Health sub-scores that make up the Overall score.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <RadarChart axes={healthAxes} />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Grid3x3 className="size-4" /> Task activity heatmap
              </CardTitle>
              <CardDescription>Completed tasks this calendar month, by day-of-week and week-of-month.</CardDescription>
            </CardHeader>
            <CardContent>
              <Heatmap grid={taskHeatmap} />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="size-4" /> Revenue by company
              </CardTitle>
              <CardDescription>Won-stage Deal value, sized by company.</CardDescription>
            </CardHeader>
            <CardContent>
              <Treemap nodes={revenueByCompany.map((c) => ({ label: c.companyName, value: c.value }))} formatValue={(v) => formatCurrency(v, currency)} />
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-4" /> Company locations
              </CardTitle>
              <CardDescription>Compact view of the full Companies Map — geocoded pins plus country-level bubbles.</CardDescription>
            </CardHeader>
            <CardContent>
              <GeoWidget organizationId={organizationId} />
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}
