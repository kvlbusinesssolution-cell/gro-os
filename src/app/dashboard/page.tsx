import { redirect } from "next/navigation";
import {
  DollarSign,
  Wallet,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  ListChecks,
  Calendar,
  Gavel,
  FileText,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Zap,
  Target,
  Clock,
  Bot,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cookies } from "next/headers";

import { computeCompanyHealth, computePipelineTotals } from "@/lib/company-health";
import { getActiveDashboard, listUserDashboards, listDashboardTemplates } from "@/lib/dashboard";
import { ACTIVE_DASHBOARD_COOKIE } from "@/lib/dashboard-templates";
import { getRecentInsights } from "@/lib/ai/insights-generator";
import { AICommandBar } from "@/components/command-center/ai-command-bar";
import { WidgetGrid } from "@/components/command-center/widget-grid";
import { ExecutiveInsights } from "@/components/command-center/executive-insights";
import { LiveAIPanel, type LiveAgentSummary } from "@/components/command-center/live-ai-panel";
import { LiveAITimeline } from "@/components/command-center/live-ai-timeline";

import { requireActiveMembership } from "./_lib/require-membership";
import {
  getRevenueTimeMetrics,
  getExecutiveCardMetrics,
  getAiProductivityMetrics,
  getProductivityDashboardMetrics,
  AI_HOURS_PER_COMPLETED_TASK,
} from "./_lib/metrics";
import { getWidgetDataBundle } from "./_lib/widget-data";
import { formatCurrency } from "./_lib/format";
import { ScoreRing } from "./_components/score-ring";
import { MetricCard } from "./_components/metric-card";
import { DashboardSwitcher } from "./_components/dashboard-switcher";
import { ParticleField } from "./_components/particle-field";

const HEALTH_SUB_SCORES: Array<{ key: "business" | "sales" | "marketing" | "crm" | "automation" | "revenue" | "security" | "ai"; label: string }> = [
  { key: "business", label: "Business" },
  { key: "sales", label: "Sales" },
  { key: "marketing", label: "Marketing" },
  { key: "crm", label: "CRM" },
  { key: "automation", label: "Automation" },
  { key: "revenue", label: "Revenue" },
  { key: "security", label: "Security" },
  { key: "ai", label: "AI" },
];

export default async function DashboardPage() {
  const { userId, membership } = await requireActiveMembership("/dashboard");
  // A Career-type organization (chosen once on /onboarding, see
  // Organization.type) never sees this business command center — its real
  // home is the Career shell instead.
  if (membership.organization.type === "CAREER") {
    redirect("/dashboard/career");
  }
  const organizationId = membership.organizationId;
  const currency = membership.organization.currency;

  const cookieStore = await cookies();
  const preferredDashboardId = cookieStore.get(ACTIVE_DASHBOARD_COOKIE)?.value;

  const [
    health,
    pipeline,
    revenueTime,
    executiveCards,
    aiProductivity,
    productivity,
    meetingsCount,
    tasksCount,
    dashboard,
    allDashboards,
    dashboardTemplates,
    widgetData,
    insights,
    agents,
    aiActivity,
  ] = await Promise.all([
    computeCompanyHealth(organizationId),
    computePipelineTotals(organizationId),
    getRevenueTimeMetrics(organizationId),
    getExecutiveCardMetrics(organizationId),
    getAiProductivityMetrics(organizationId),
    getProductivityDashboardMetrics(organizationId),
    prisma.meeting.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId } }),
    getActiveDashboard(userId, organizationId, preferredDashboardId),
    listUserDashboards(userId, organizationId),
    listDashboardTemplates(organizationId),
    getWidgetDataBundle(organizationId),
    getRecentInsights(organizationId),
    prisma.aIAgentInstance.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, name: true, active: true, status: true, currentTask: true },
    }),
    prisma.activity.findMany({
      where: { organizationId, actorAgentId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actorAgent: { select: { name: true } } },
    }),
  ]);

  const liveAgents: LiveAgentSummary[] = agents;
  const timelineItems = aiActivity.map((a) => ({
    id: a.id,
    description: a.description,
    actorName: a.actorAgent?.name ?? null,
    createdAt: a.createdAt,
  }));

  const maxWeeklyCount = Math.max(1, ...productivity.weeklyPerformance.map((d) => d.count));
  const maxDealsStage = Math.max(1, ...revenueTime.dealsProgress.map((s) => s.count));

  const GrowthIcon = revenueTime.growthPct == null ? Minus : revenueTime.growthPct >= 0 ? TrendingUp : TrendingDown;

  return (
    <main className="min-h-svh bg-background py-10">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {membership.organization.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your Command Center — real numbers from your workspace, no examples.
            </p>
          </div>
          <AICommandBar />
        </div>

        {/* Company Health */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Company Health</h2>
          <Card glass>
            <CardContent className="flex flex-col items-center gap-8 p-8 lg:flex-row lg:items-start lg:justify-between">
              <div className="relative flex items-center justify-center">
                <ParticleField className="pointer-events-none absolute inset-0 -z-10 size-full scale-150" />
                <ScoreRing value={health.overall} label="Overall health" />
              </div>
              <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4 lg:max-w-2xl">
                {HEALTH_SUB_SCORES.map((s) => (
                  <div key={s.key} className="flex flex-col items-center gap-1.5 rounded-xl border border-border p-4">
                    <span className="text-xl font-semibold tracking-tight text-foreground">{Math.round(health[s.key])}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Revenue & Pipeline */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Revenue &amp; Pipeline</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <MetricCard icon={Wallet} label="Pipeline value" value={formatCurrency(pipeline.pipelineValue, currency)} />
            <MetricCard icon={DollarSign} label="Won value" value={formatCurrency(pipeline.wonValue, currency)} />
            <MetricCard icon={DollarSign} label="Monthly revenue" value={formatCurrency(revenueTime.monthlyRevenue, currency)} />
            <MetricCard icon={DollarSign} label="Yearly revenue" value={formatCurrency(revenueTime.yearlyRevenue, currency)} />
            <MetricCard
              icon={GrowthIcon}
              label="Growth (30d)"
              value={revenueTime.growthPct == null ? "—" : `${revenueTime.growthPct >= 0 ? "+" : ""}${revenueTime.growthPct.toFixed(1)}%`}
              sublabel={revenueTime.growthPct == null ? "Not enough data yet" : "vs. prior 30 days"}
            />
          </div>
        </section>

        {/* Executive Insights */}
        <ExecutiveInsights initialInsights={insights} />

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-10">
        {/* Core counts */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Leads", value: pipeline.totalLeadsCount, icon: Users },
            { label: "Deals", value: pipeline.leadsWithValueCount, icon: Target },
            { label: "Meetings", value: meetingsCount, icon: Calendar },
            { label: "Tasks", value: tasksCount, icon: ListChecks },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-6">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                <AnimatedCounter value={stat.value} className="mt-2 block text-3xl font-semibold tracking-tight text-foreground" />
              </CardContent>
            </Card>
          ))}
        </section>

        {/* AI Productivity & Automation */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">AI Productivity</CardTitle>
              <CardDescription>Average active-agent confidence and total completed work.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Cpu className="size-5 text-primary" />
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {aiProductivity.avgConfidence == null ? "—" : `${Math.round(aiProductivity.avgConfidence)}%`}
                </span>
                <span className="text-xs text-muted-foreground">avg confidence</span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-primary" />
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {aiProductivity.totalAgentCompletedTasks}
                </span>
                <span className="text-xs text-muted-foreground">tasks completed</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Automation Status</CardTitle>
              <CardDescription>Share of completed tasks done by an agent vs. a human.</CardDescription>
            </CardHeader>
            <CardContent>
              {aiProductivity.automationPct == null ? (
                <p className="text-sm text-muted-foreground">Not enough completed tasks yet.</p>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${aiProductivity.automationPct}%` }} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground">{Math.round(aiProductivity.automationPct)}% agent-driven</span>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Executive Cards */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Today</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon={Users} label="Today's leads" value={executiveCards.todaysLeads} />
            <MetricCard icon={Calendar} label="Today's meetings" value={executiveCards.todaysMeetings} />
            <MetricCard icon={Gavel} label="AI decisions pending" value={executiveCards.aiDecisionsPending} href="/board" />
            <MetricCard icon={FileText} label="Proposals ready" value={executiveCards.proposalsReady} href="/board/tasks" />
            <MetricCard icon={Mail} label="Outreach ready" value={executiveCards.outreachReady} href="/board/tasks" />
            <MetricCard icon={AlertTriangle} label="Urgent tasks" value={executiveCards.urgentTasks} href="/board/tasks" />
            <MetricCard icon={Bot} label="Approvals pending" value={executiveCards.approvalsPending} href="/board" />
          </div>
          <p className="text-xs text-muted-foreground">
            &ldquo;AI decisions pending&rdquo; and &ldquo;Approvals pending&rdquo; both count PENDING Decision rows — they&rsquo;re the same
            real number shown two ways. &ldquo;Outreach ready&rdquo; combines email and LinkedIn tasks since completed Outreach-agent
            tasks have no channel field to split them by.
          </p>
        </section>

        {/* Productivity Dashboard */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Productivity Dashboard</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MetricCard icon={CheckCircle2} label="Tasks completed" value={productivity.tasksCompleted} />
            <MetricCard icon={Calendar} label="Meetings held" value={productivity.meetingsHeld} />
            <MetricCard
              icon={Clock}
              label="AI hours saved (estimate)"
              value={productivity.aiHoursSavedEstimate.toFixed(1)}
              sublabel={`Estimate: ${AI_HOURS_PER_COMPLETED_TASK}h × agent-completed tasks — not a measurement`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Deals progress</CardTitle>
                <CardDescription>Real lead counts per pipeline stage.</CardDescription>
              </CardHeader>
              <CardContent>
                {revenueTime.dealsProgress.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leads yet.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {revenueTime.dealsProgress.map((stage) => (
                      <div key={stage.stageName} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{stage.stageName}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max((stage.count / maxDealsStage) * 100, stage.count > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-xs font-medium text-foreground">{stage.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Automation success</CardTitle>
                <CardDescription>Agent-assigned tasks that completed vs. blocked/cancelled.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                {productivity.automationSuccessPct == null ? (
                  <p className="text-sm text-muted-foreground">Not enough data yet.</p>
                ) : (
                  <>
                    <Zap className="size-6 shrink-0 text-primary" />
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${productivity.automationSuccessPct}%` }} />
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-foreground">{Math.round(productivity.automationSuccessPct)}%</span>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Weekly performance</CardTitle>
              <CardDescription>Tasks completed per day, last 7 days (by Task.updatedAt).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-32 items-end justify-between gap-2 sm:gap-4">
                {productivity.weeklyPerformance.map((day) => {
                  const pct = Math.round((day.count / maxWeeklyCount) * 100);
                  return (
                    <div key={day.label} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-24 w-full items-end overflow-hidden rounded-md bg-muted">
                        <div className="w-full rounded-md bg-primary transition-[height]" style={{ height: `${Math.max(pct, day.count > 0 ? 6 : 0)}%` }} />
                      </div>
                      <span className="text-xs font-medium text-foreground">{day.count}</span>
                      <span className="text-[11px] text-muted-foreground">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Widget Grid */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Widgets</h2>
            <DashboardSwitcher
              dashboards={allDashboards.map((d) => ({ id: d.id, name: d.name, isDefault: d.isDefault }))}
              activeDashboardId={dashboard.id}
              templates={dashboardTemplates.map((t) => ({ id: t.id, name: t.name }))}
            />
          </div>
          <WidgetGrid dashboardId={dashboard.id} widgets={dashboard.widgets} currency={currency} data={widgetData} />
        </section>
          </div>

          {/* Right rail: Live AI Panel + Live AI Timeline */}
          <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:h-fit">
            <LiveAIPanel agents={liveAgents} />
            <LiveAITimeline items={timelineItems} />
          </aside>
        </div>
      </Container>
    </main>
  );
}
