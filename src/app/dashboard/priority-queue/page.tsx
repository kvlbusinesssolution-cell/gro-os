import Link from "next/link";
import { ListOrdered, RotateCcw, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";
import {
  confidenceBadgeClassName,
  PRIORITY_BADGE_CLASSNAME,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  recommendedNextAction,
} from "../opportunities/_lib/opportunity-display";
import type { OpportunityPriority, Prisma } from "@/generated/prisma/client";

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

function isOpportunityPriority(value: string | undefined): value is OpportunityPriority {
  return !!value && (PRIORITY_OPTIONS as readonly string[]).includes(value);
}

function parseMinScore(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

interface PriorityQueueSearchParams {
  priority?: string;
  minLeadScore?: string;
  minIntentScore?: string;
  minOpportunityScore?: string;
  service?: string;
  country?: string;
  industry?: string;
}

export default async function PriorityQueuePage({
  searchParams,
}: {
  searchParams: Promise<PriorityQueueSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/priority-queue");
  const organizationId = membership.organizationId;

  const priorityFilter = isOpportunityPriority(params.priority) ? params.priority : undefined;
  const minLeadScore = parseMinScore(params.minLeadScore);
  const minIntentScore = parseMinScore(params.minIntentScore);
  const minOpportunityScore = parseMinScore(params.minOpportunityScore);
  const service = params.service?.trim() || undefined;
  const country = params.country?.trim() || undefined;
  const industry = params.industry?.trim() || undefined;

  const conditions: Prisma.LeadOpportunityWhereInput[] = [{ company: { organizationId } }];
  if (priorityFilter) conditions.push({ priority: priorityFilter });
  if (minOpportunityScore !== undefined) conditions.push({ opportunityScore: { gte: minOpportunityScore } });
  if (minLeadScore !== undefined) conditions.push({ company: { leadScore: { overallScore: { gte: minLeadScore } } } });
  if (minIntentScore !== undefined) conditions.push({ company: { intentScore: { score: { gte: minIntentScore } } } });
  if (service) conditions.push({ recommendedService: service });
  if (country) conditions.push({ company: { headquartersCountry: country } });
  if (industry) conditions.push({ company: { industry } });

  const where: Prisma.LeadOpportunityWhereInput = { AND: conditions };

  const [opportunities, countryRows, industryRows, priorityCounts, unscoredCount] = await Promise.all([
    // Default sort: HOT-first-then-by-score, entirely via a real Prisma
    // orderBy — no client-side sort. `OpportunityPriority` is a native
    // Postgres enum declared HOT, HIGH, MEDIUM, NURTURE, LOW, DISQUALIFIED
    // (see prisma/migrations/20260917073320_.../migration.sql) — Postgres
    // enums sort by that declaration order, not alphabetically, so
    // `priority: "asc"` already puts HOT first / DISQUALIFIED last with no
    // extra mapping needed. `nulls: "last"` (same option this codebase
    // already uses for nullable orderBy fields — see
    // src/lib/workflows/crud.ts) sends not-yet-scored opportunities to the
    // bottom rather than raising a query error or sorting them first.
    // Within each priority tier, `opportunityScore desc` (also nulls-last)
    // ranks by the numeric score.
    prisma.leadOpportunity.findMany({
      where,
      orderBy: [
        { priority: { sort: "asc", nulls: "last" } },
        { opportunityScore: { sort: "desc", nulls: "last" } },
      ],
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
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Priority Queue</h1>
          <p className="text-sm text-muted-foreground">
            Every AI Opportunity ranked by priority, then by Opportunity Score — a triage/ranking surface only.
            Click through to an opportunity&apos;s own brief page to review evidence, the Target Contact, and take
            action. Nothing here sends outreach automatically.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {priorityCounts.map(({ priority, count }) => (
            <Link
              key={priority}
              href={priorityFilter === priority ? "/dashboard/priority-queue" : `/dashboard/priority-queue?priority=${priority}`}
              className={`glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                priorityFilter === priority ? "ring-2 ring-primary" : ""
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
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/priority-queue" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="priority" className="text-xs text-muted-foreground">
                  Priority
                </label>
                <Select id="priority" name="priority" defaultValue={priorityFilter ?? ""} className="w-40">
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
                <Input
                  id="minLeadScore"
                  name="minLeadScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={minLeadScore ?? ""}
                  placeholder="0"
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minIntentScore" className="text-xs text-muted-foreground">
                  Min Intent Score
                </label>
                <Input
                  id="minIntentScore"
                  name="minIntentScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={minIntentScore ?? ""}
                  placeholder="0"
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minOpportunityScore" className="text-xs text-muted-foreground">
                  Min Opportunity Score
                </label>
                <Input
                  id="minOpportunityScore"
                  name="minOpportunityScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={minOpportunityScore ?? ""}
                  placeholder="0"
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="service" className="text-xs text-muted-foreground">
                  Service
                </label>
                <Select id="service" name="service" defaultValue={service ?? ""} className="w-56">
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
                <Select id="country" name="country" defaultValue={country ?? ""} className="w-44">
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
                <Select id="industry" name="industry" defaultValue={industry ?? ""} className="w-44">
                  <option value="">All industries</option>
                  {industryRows.map((i) => (
                    <option key={i.industry} value={i.industry!}>
                      {i.industry}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
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

        {opportunities.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Sparkles className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No opportunities match these filters. The Priority Queue only ranks opportunities the AI Opportunity
                Engine has already generated — research a company and generate opportunities first, or widen the
                filters above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Lead Score</TableHead>
                    <TableHead>Intent Score</TableHead>
                    <TableHead>Opportunity Score</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Recommended next action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opportunities.map((opportunity) => {
                    const service = opportunity.recommendedService
                      ? KVL_SERVICE_BY_ID.get(opportunity.recommendedService as KVLServiceId)
                      : null;
                    const nextAction = recommendedNextAction({
                      status: opportunity.status,
                      nextStep: opportunity.nextStep,
                      recommendedServiceLabel: service?.label ?? null,
                    });

                    return (
                      <TableRow key={opportunity.id}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />
                            <div>
                              <Link
                                href={`/dashboard/companies/${opportunity.company.id}`}
                                className="font-medium text-foreground transition-colors hover:text-primary"
                              >
                                {opportunity.company.name}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {[opportunity.company.industry, opportunity.company.headquartersCountry].filter(Boolean).join(" · ") ||
                                  "No profile details yet"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/dashboard/opportunities/${opportunity.id}`}
                            className="font-medium text-foreground transition-colors hover:text-primary"
                          >
                            {opportunity.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {opportunity.company.leadScore ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(opportunity.company.leadScore.overallScore)}`}
                            >
                              {opportunity.company.leadScore.overallScore} · {opportunity.company.leadScore.band}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scored yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {opportunity.company.intentScore ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(opportunity.company.intentScore.score)}`}
                            >
                              {opportunity.company.intentScore.score} · {opportunity.company.intentScore.band}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scored yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {opportunity.opportunityScore !== null ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(opportunity.opportunityScore)}`}
                            >
                              {opportunity.opportunityScore}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scored yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {opportunity.priority ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PRIORITY_BADGE_CLASSNAME[opportunity.priority]}`}
                            >
                              {PRIORITY_LABEL[opportunity.priority]}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scored yet</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <p className="line-clamp-2 text-sm text-muted-foreground">{nextAction}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}
