import Link from "next/link";
import {
  Users,
  ListChecks,
  Calendar,
  Handshake,
  Trophy,
  XCircle,
  DollarSign,
  Wallet,
  Clock,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { getRecentRecommendations } from "@/lib/recommendations";
import { requireActiveMembership } from "../_lib/require-membership";
import { formatCurrency } from "../_lib/format";
import { MetricCard } from "../_components/metric-card";
import { RecommendationsPanel } from "../_components/recommendations-panel";
import { getCrmDashboardMetrics, getUpcomingDeadlines } from "./_lib/metrics";
import { formatRelativeTime } from "@/lib/utils";

/**
 * The CRM Dashboard — the CRM section's landing page. The old
 * pipeline+clients board that used to live at this URL now lives at
 * /dashboard/crm/pipeline (moved verbatim, nothing lost — see
 * src/app/dashboard/crm/pipeline/page.tsx).
 */
export default async function CrmDashboardPage() {
  const { membership } = await requireActiveMembership("/dashboard/crm");
  const organizationId = membership.organizationId;
  const currency = membership.organization.currency;

  const [metrics, deadlines, recommendations, recentActivity] = await Promise.all([
    getCrmDashboardMetrics(organizationId),
    getUpcomingDeadlines(organizationId),
    getRecentRecommendations(organizationId),
    prisma.activity.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { actorUser: { select: { name: true } }, actorAgent: { select: { name: true } } },
    }),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">CRM Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Your sales pipeline at a glance — real numbers from Deals, Tasks, and Meetings, updated live.
            </p>
          </div>
          <Link
            href="/dashboard/crm/sales-view"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Users className="size-3.5" /> Client-wise Sales View
          </Link>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Today</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon={Users} label="Today's leads" value={metrics.todaysLeads} href="/dashboard/crm/pipeline" />
            <MetricCard icon={ListChecks} label="Today's tasks" value={metrics.todaysTasks} href="/dashboard/crm/tasks" />
            <MetricCard icon={Calendar} label="Today's meetings" value={metrics.todaysMeetings} href="/dashboard/crm/calendar" />
            <MetricCard icon={Clock} label="Upcoming deadlines (7d)" value={metrics.upcomingDeadlinesCount} href="/dashboard/crm/calendar" />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Pipeline</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon={Handshake} label="Open deals" value={metrics.openDeals} href="/dashboard/crm/deals" />
            <MetricCard icon={Trophy} label="Deals won" value={metrics.dealsWon} href="/dashboard/crm/deals" />
            <MetricCard icon={XCircle} label="Deals lost" value={metrics.dealsLost} href="/dashboard/crm/deals" />
            <MetricCard icon={Wallet} label="Pipeline value" value={formatCurrency(metrics.pipelineValue, currency)} href="/dashboard/crm/forecast" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard icon={DollarSign} label="Revenue (Won deals)" value={formatCurrency(metrics.revenue, currency)} href="/dashboard/crm/reports" />
            <MetricCard icon={Wallet} label="Open pipeline value" value={formatCurrency(metrics.pipelineValue, currency)} href="/dashboard/crm/deals" />
          </div>
        </section>

        <RecommendationsPanel initialRecommendations={recommendations} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Latest CRM events across your organization.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                recentActivity.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                    <span className="text-foreground">{a.description}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(a.createdAt)}</span>
                  </div>
                ))
              )}
              <Link href="/dashboard/crm/activity" className="mt-2 text-xs text-primary hover:underline">
                View full activity feed →
              </Link>
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Deadlines</CardTitle>
              <CardDescription>Tasks due and deals expected to close in the next 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {deadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing due in the next 7 days.</p>
              ) : (
                deadlines.map((d) => (
                  <Link
                    key={`${d.kind}-${d.id}`}
                    href={d.kind === "task" ? "/dashboard/crm/tasks" : `/dashboard/crm/deals/${d.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-accent/30"
                  >
                    <span className="text-foreground">{d.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {d.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </Link>
                ))
              )}
              <Link href="/dashboard/crm/calendar" className="mt-2 text-xs text-primary hover:underline">
                View calendar →
              </Link>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}
