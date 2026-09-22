import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";
import { PRIORITY_LABEL, PRIORITY_OPTIONS, recommendedNextAction } from "../opportunities/_lib/opportunity-display";
import { listPriorityQueueViews } from "./actions";
import { PriorityQueueTable } from "./_components/priority-queue-table";
import { SaveViewButton } from "./_components/save-view-button";
import { SavedViewsBar } from "./_components/saved-views-bar";
import { PAGE_SIZE, buildPriorityQueueOrderBy, buildPriorityQueueWhere, daysSince, isInFuture, parsePriorityQueueFilters, type PriorityQueueSearchParams } from "./_lib/queries";
import type { PriorityQueueRow } from "./_lib/types";
import type { OpportunityScoreBreakdown } from "@/lib/business-development/opportunity-priority";

function serializableParams(params: PriorityQueueSearchParams): Record<string, string> {
  const entries = Object.entries(params).filter(([key, value]) => key !== "page" && value != null && value !== "");
  return Object.fromEntries(entries) as Record<string, string>;
}

export default async function PriorityQueuePage({
  searchParams,
}: {
  searchParams: Promise<PriorityQueueSearchParams>;
}) {
  const rawParams = await searchParams;
  const { userId, membership } = await requireActiveMembership("/dashboard/priority-queue");
  const organizationId = membership.organizationId;

  const filters = parsePriorityQueueFilters(rawParams);
  const where = buildPriorityQueueWhere(organizationId, filters, userId);
  const orderBy = buildPriorityQueueOrderBy(filters);
  const activeParams = serializableParams(rawParams);

  const [
    total,
    opportunities,
    countryRows,
    industryRows,
    priorityCounts,
    unscoredCount,
    snoozedCount,
    members,
    savedViews,
  ] = await Promise.all([
    prisma.leadOpportunity.count({ where }),
    prisma.leadOpportunity.findMany({
      where,
      orderBy,
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            industry: true,
            headquartersCountry: true,
            leadScore: { select: { overallScore: true, band: true } },
            intentScore: { select: { score: true, band: true } },
          },
        },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.company.findMany({
      where: { organizationId, headquartersCountry: { not: null }, leadOpportunities: { some: {} } },
      select: { headquartersCountry: true },
      distinct: ["headquartersCountry"],
      orderBy: { headquartersCountry: "asc" },
    }),
    prisma.company.findMany({
      where: { organizationId, industry: { not: null }, leadOpportunities: { some: {} } },
      select: { industry: true },
      distinct: ["industry"],
      orderBy: { industry: "asc" },
    }),
    Promise.all(
      PRIORITY_OPTIONS.map(async (p) => ({
        priority: p,
        count: await prisma.leadOpportunity.count({ where: { company: { organizationId }, priority: p } }),
      })),
    ),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, priority: null } }),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, snoozedUntil: { gt: new Date() } } }),
    prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    listPriorityQueueViews(),
  ]);

  const memberOptions = members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email ?? "" }));

  // Phase 11 §44 — the latest real, point-in-time LearningShadowScore per
  // opportunity (never applied to opportunityScore itself; see
  // src/lib/learning/shadow.ts).
  const shadowScores = await prisma.learningShadowScore.findMany({
    where: { organizationId, leadOpportunityId: { in: opportunities.map((o) => o.id) } },
    orderBy: { computedAt: "desc" },
    distinct: ["leadOpportunityId"],
  });
  const shadowByOppId = new Map(shadowScores.map((s) => [s.leadOpportunityId, s]));

  const rows: PriorityQueueRow[] = opportunities.map((o) => {
    const service = o.recommendedService ? KVL_SERVICES.find((s) => s.id === o.recommendedService) : null;
    return {
      id: o.id,
      title: o.title,
      companyId: o.company.id,
      companyName: o.company.name,
      companyIndustry: o.company.industry,
      companyCountry: o.company.headquartersCountry,
      leadScore: o.company.leadScore?.overallScore ?? null,
      leadScoreBand: o.company.leadScore?.band ?? null,
      intentScore: o.company.intentScore?.score ?? null,
      intentScoreBand: o.company.intentScore?.band ?? null,
      opportunityScore: o.opportunityScore,
      previousOpportunityScore: o.previousOpportunityScore,
      opportunityScoreBreakdown: (o.opportunityScoreBreakdown as unknown as OpportunityScoreBreakdown | null) ?? null,
      priority: o.priority,
      priorityReasoning: o.priorityReasoning,
      status: o.status,
      nextAction: recommendedNextAction({ status: o.status, nextStep: o.nextStep, recommendedServiceLabel: service?.label ?? null }),
      createdAt: o.createdAt.toISOString(),
      ageDays: daysSince(o.createdAt),
      ownerUserId: o.ownerUserId,
      ownerName: o.owner?.name ?? o.owner?.email ?? null,
      snoozedUntil: o.snoozedUntil ? o.snoozedUntil.toISOString() : null,
      isSnoozed: isInFuture(o.snoozedUntil),
      learningShadow: (() => {
        const s = shadowByOppId.get(o.id);
        return s ? { shadowScore: s.shadowScore, scoreDiff: s.scoreDiff, basisPatternIds: s.basisPatternIds } : null;
      })(),
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQuery = new URLSearchParams(activeParams).toString();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Priority Queue</h1>
              <p className="text-sm text-muted-foreground">
                Every AI Opportunity ranked by priority, then by Opportunity Score — a triage/action surface, not just a list.
                Add to CRM, dismiss, assign, or snooze right from a row — nothing here sends outreach automatically.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SaveViewButton params={activeParams} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/api/export/priority-queue${exportQuery ? `?${exportQuery}` : ""}`}>
                  <Download className="size-3.5" /> Export CSV
                </Link>
              </Button>
            </div>
          </div>
          <div className="gold-shimmer-line" />
        </div>

        <SavedViewsBar views={savedViews} activeParams={activeParams} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {priorityCounts.map(({ priority, count }) => (
            <Link
              key={priority}
              href={filters.priority === priority ? "/dashboard/priority-queue" : `/dashboard/priority-queue?priority=${priority}`}
              className={`glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                filters.priority === priority ? "ring-2 ring-primary" : ""
              }`}
            >
              <span className="text-[11px] text-muted-foreground">{PRIORITY_LABEL[priority]}</span>
              <span className="text-xl font-semibold tracking-tight text-foreground">
                <AnimatedCounter value={count} />
              </span>
            </Link>
          ))}
          <div className="glass-panel flex flex-col gap-1.5 rounded-xl p-3.5">
            <span className="text-[11px] text-muted-foreground">Not scored yet</span>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              <AnimatedCounter value={unscoredCount} />
            </span>
          </div>
          <Link
            href={filters.priority ? "/dashboard/priority-queue?snoozed=1" : "/dashboard/priority-queue?snoozed=1"}
            className="glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors"
          >
            <span className="text-[11px] text-muted-foreground">Snoozed</span>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              <AnimatedCounter value={snoozedCount} />
            </span>
          </Link>
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/priority-queue" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="q" className="text-xs text-muted-foreground">
                  Search
                </label>
                <Input id="q" name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Company or opportunity..." className="w-56" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="priority" className="text-xs text-muted-foreground">
                  Priority
                </label>
                <Select id="priority" name="priority" defaultValue={filters.priority ?? ""} className="w-40">
                  <option value="">All priorities</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minLeadScore" className="text-xs text-muted-foreground">
                  Min Lead Score
                </label>
                <Input id="minLeadScore" name="minLeadScore" type="number" min={0} max={100} defaultValue={filters.minLeadScore ?? ""} placeholder="0" className="w-28" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minIntentScore" className="text-xs text-muted-foreground">
                  Min Intent Score
                </label>
                <Input id="minIntentScore" name="minIntentScore" type="number" min={0} max={100} defaultValue={filters.minIntentScore ?? ""} placeholder="0" className="w-28" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minOpportunityScore" className="text-xs text-muted-foreground">
                  Min Opportunity Score
                </label>
                <Input id="minOpportunityScore" name="minOpportunityScore" type="number" min={0} max={100} defaultValue={filters.minOpportunityScore ?? ""} placeholder="0" className="w-28" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="service" className="text-xs text-muted-foreground">
                  Service
                </label>
                <Select id="service" name="service" defaultValue={filters.service ?? ""} className="w-56">
                  <option value="">All services</option>
                  {KVL_SERVICES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="country" className="text-xs text-muted-foreground">
                  Country
                </label>
                <Select id="country" name="country" defaultValue={filters.country ?? ""} className="w-44">
                  <option value="">All countries</option>
                  {countryRows.map((c) => (
                    <option key={c.headquartersCountry} value={c.headquartersCountry!}>
                      {c.headquartersCountry}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="industry" className="text-xs text-muted-foreground">
                  Industry
                </label>
                <Select id="industry" name="industry" defaultValue={filters.industry ?? ""} className="w-44">
                  <option value="">All industries</option>
                  {industryRows.map((i) => (
                    <option key={i.industry} value={i.industry!}>
                      {i.industry}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="owner" className="text-xs text-muted-foreground">
                  Owner
                </label>
                <Select id="owner" name="owner" defaultValue={filters.owner ?? ""} className="w-44">
                  <option value="">Everyone</option>
                  <option value="me">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                  {memberOptions.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex h-11 items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="snoozed" value="1" defaultChecked={filters.includeSnoozed} className="size-4 rounded border-input" />
                Show snoozed
              </label>
              <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Apply filters
              </button>
              <Link
                href="/dashboard/priority-queue"
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Link>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <p className="text-sm text-muted-foreground">
                No opportunities match these filters. The Priority Queue only ranks opportunities the AI Opportunity
                Engine has already generated — research a company and generate opportunities first, or widen the
                filters above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="flex flex-col gap-4 p-4">
              <PriorityQueueTable rows={rows} currentUserId={userId} members={memberOptions} />
            </CardContent>
          </Card>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {(filters.page - 1) * PAGE_SIZE + 1}–{Math.min(filters.page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/priority-queue?${new URLSearchParams({ ...activeParams, page: String(Math.max(1, filters.page - 1)) }).toString()}`}
                aria-disabled={filters.page <= 1}
                className={`rounded-lg border border-border px-3 py-1.5 transition-colors ${filters.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent hover:text-foreground"}`}
              >
                Previous
              </Link>
              <span>
                Page {filters.page} of {totalPages}
              </span>
              <Link
                href={`/dashboard/priority-queue?${new URLSearchParams({ ...activeParams, page: String(Math.min(totalPages, filters.page + 1)) }).toString()}`}
                aria-disabled={filters.page >= totalPages}
                className={`rounded-lg border border-border px-3 py-1.5 transition-colors ${filters.page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-accent hover:text-foreground"}`}
              >
                Next
              </Link>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
}
