import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ListChecks,
  ShieldAlert,
  Lightbulb,
  Sparkles,
  TrendingUp,
  Flame,
  FileText,
  Users2,
  Handshake,
} from "lucide-react";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import { computeTodaysActions } from "@/lib/ai/daily-action-center";
import type { GrowthSignals } from "@/lib/ai/executive-briefing";

interface RevenueForecastShape {
  day: { total: number; confidenceScore: number };
  cashFlowNext4Weeks: number;
}

/**
 * Same "never a bare misleading 0" discipline as
 * buildGrowthSignalsSummaryLines in executive-briefing.ts: a real 0 (or a
 * missing brief entirely) renders as an honest "No X yet" sentence rather
 * than an ambiguous "0" tile, while any real positive count renders as the
 * plain number.
 */
function signalStatValue(signals: GrowthSignals | null, count: number, zeroText: string): string | number {
  if (!signals || count === 0) return zeroText;
  return count;
}

/**
 * Phase 10 (Autonomous Growth Operating System) — the "Daily Action Center"
 * from the spec: today's real ExecutiveBriefing (deterministic fields +
 * GrowthSignals), rendered honestly (zero/null -> "No X yet", never blank),
 * plus a real numbered TODAY'S AI ACTIONS list composed deterministically
 * from real Phase 1-9/ActionItem rows (computeTodaysActions).
 *
 * Deliberately read-only/navigational: every action item is a Link to the
 * real existing page where a human takes the actual approve/send/review
 * action (Proposals, Priority Queue, Outreach, CRM Deals, Action Items).
 * There is no bulk-approve/auto-execute control here — "human approval
 * should remain available for consequential actions" per the spec, and
 * every consequential action already has its own approval gate on the page
 * it links to (checkApprovalGate for proposals, the DRAFT -> Approve -> Send
 * pipeline for outreach drafts, etc.).
 */
export default async function TodayActionCenterPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=%2Fboard%2Ftoday");
  }
  const userId = session.user.id;

  const membership = await prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: { organization: true },
  });
  if (!membership) {
    redirect("/onboarding");
  }
  const organizationId = membership.organizationId;

  const [latestBrief, todaysActions] = await Promise.all([
    prisma.executiveBriefing.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    }),
    computeTodaysActions(organizationId),
  ]);

  const signals = (latestBrief?.growthSignals as unknown as GrowthSignals | null) ?? null;
  const revenueForecast = latestBrief && latestBrief.type !== "CUSTOMER_SUCCESS"
    ? (latestBrief.revenueForecast as unknown as RevenueForecastShape)
    : null;

  return (
    <main className="min-h-svh bg-background py-12">
      <Container className="flex flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Daily Action Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {membership.organization.name}&rsquo;s real, deterministic priorities for today — every figure below
            traces to a real row, and every action links to the real page where a human approves it.
          </p>
        </div>

        {/* Today's AI Actions */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Today&rsquo;s AI Actions</h2>
          {todaysActions.length === 0 ? (
            <Card glass>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Sparkles className="size-8 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">
                  Nothing needs your attention right now — no real rows are waiting on you today.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col divide-y divide-border p-0">
                {todaysActions.map((action, i) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                        {i + 1}
                      </span>
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{action.count}</span> {action.label}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">
            Recommended and linked only — every approve/send/review action happens on its real destination page,
            with the same human-approval gate it already enforces there.
          </p>
        </section>

        {/* Today's brief */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Today&rsquo;s Brief</h2>
            {latestBrief ? (
              <Link href={`/board/brief/${latestBrief.id}`} className="text-sm font-medium text-primary hover:underline">
                View full brief
              </Link>
            ) : null}
          </div>

          {!latestBrief ? (
            <Card glass>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No executive briefing generated yet — the AI CEO Daily Brief runs weekday mornings at 6am.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Most recent briefing, generated {formatRelativeTime(latestBrief.createdAt)}.
              </p>

              {latestBrief.narrativeSummary ? (
                <Card glass>
                  <CardContent className="p-5">
                    <p className="text-sm text-foreground">{latestBrief.narrativeSummary}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      AI-composed from the real figures below — never an independent source of numbers.
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Revenue (today)" value={revenueForecast ? revenueForecast.day.total.toFixed(2) : "No forecast yet"} />
                <StatCard label="New leads" value={latestBrief.newLeadsCount > 0 ? latestBrief.newLeadsCount : "No new leads yet"} />
                <StatCard label="Pending approvals" value={latestBrief.pendingApprovalsCount > 0 ? latestBrief.pendingApprovalsCount : "No pending approvals"} />
                <StatCard
                  label="Opportunities"
                  value={
                    (latestBrief.opportunities as unknown as unknown[] | null)?.length
                      ? (latestBrief.opportunities as unknown as unknown[]).length
                      : "No opportunities yet"
                  }
                />
                <StatCard
                  label="New opportunities"
                  value={signalStatValue(signals, signals?.newOpportunitiesCount ?? 0, "No new opportunities since yesterday")}
                  icon={TrendingUp}
                />
                <StatCard
                  label="HOT opportunities"
                  value={signalStatValue(signals, signals?.hotOpportunitiesCount ?? 0, "No HOT opportunities right now")}
                  icon={Flame}
                />
                <StatCard
                  label="Pending proposals"
                  value={signalStatValue(signals, signals?.pendingProposalsCount ?? 0, "No proposals pending a response")}
                  hint={
                    signals && signals.oldestPendingProposalAgeDays != null
                      ? `Oldest ${signals.oldestPendingProposalAgeDays} day(s)`
                      : undefined
                  }
                  icon={FileText}
                />
                <StatCard
                  label="At-risk deals"
                  value={signalStatValue(signals, signals?.atRiskDealsCount ?? 0, "No deals gone quiet")}
                  icon={Handshake}
                />
                <StatCard
                  label="Referral partner candidates"
                  value={signalStatValue(signals, signals?.referralPartnerCandidatesCount ?? 0, "No referral candidates yet")}
                  icon={Users2}
                />
              </div>

              {/* Replies by intent */}
              <Card glass>
                <CardHeader>
                  <CardTitle className="text-sm">Replies received (last day) by intent</CardTitle>
                  <CardDescription>Real Reply.groupBy(intent) since yesterday.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!signals || signals.repliesByIntent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No replies received since yesterday.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {signals.repliesByIntent.map((r) => (
                        <Badge key={r.intent ?? "UNCLASSIFIED"} variant="outline">
                          {r.intent ?? "UNCLASSIFIED"}: {r.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Acquisition funnel */}
              <Card glass>
                <CardHeader>
                  <CardTitle className="text-sm">Client acquisition funnel</CardTitle>
                  <CardDescription>
                    All-time snapshot (computeAcquisitionOverview) —{" "}
                    {signals ? `total won revenue ${signals.acquisitionTotalRevenue.toFixed(2)}` : "no data yet"}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!signals || signals.acquisitionFunnel.every((s) => s.count === 0) ? (
                    <p className="text-sm text-muted-foreground">No client acquisition funnel data yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {signals.acquisitionFunnel.map((s) => (
                        <Badge key={s.stage} variant="secondary">
                          {s.stage}: {s.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card glass>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldAlert className="size-4" /> Critical Risks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {latestBrief.risks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active risks.</p>
                    ) : (
                      latestBrief.risks.map((r, i) => (
                        <p key={i} className="text-sm text-foreground">
                          {r}
                        </p>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card glass>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Lightbulb className="size-4" /> Growth Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {latestBrief.recommendedActions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recommendations on record.</p>
                    ) : (
                      latestBrief.recommendedActions.map((a, i) => (
                        <p key={i} className="text-sm text-foreground">
                          {a}
                        </p>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </section>

        <Link
          href="/board/action-items"
          className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ListChecks className="size-4" /> Browse all action items <ArrowRight className="size-4" />
        </Link>
      </Container>
    </main>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
        </div>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
