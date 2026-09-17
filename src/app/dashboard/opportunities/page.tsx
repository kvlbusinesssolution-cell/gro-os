import Link from "next/link";
import { Building2, RotateCcw, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";
import {
  CONFIDENCE_THRESHOLD_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_BADGE_CLASSNAME,
  confidenceBadgeClassName,
} from "./_lib/opportunity-display";
import { OpportunityActions } from "./_components/opportunity-actions";
import type { OpportunityStatus, Prisma } from "@/generated/prisma/client";

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

function isOpportunityStatus(value: string | undefined): value is OpportunityStatus {
  return !!value && (STATUS_OPTIONS as readonly string[]).includes(value);
}

interface OpportunitiesPageSearchParams {
  country?: string;
  industry?: string;
  service?: string;
  category?: string;
  minConfidence?: string;
  status?: string;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<OpportunitiesPageSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/opportunities");
  const organizationId = membership.organizationId;

  const country = params.country?.trim() || undefined;
  const industry = params.industry?.trim() || undefined;
  const service = params.service?.trim() || undefined;
  const category = params.category?.trim() || undefined;
  const statusFilter = isOpportunityStatus(params.status) ? params.status : undefined;
  const minConfidenceRaw = params.minConfidence?.trim();
  const minConfidence = minConfidenceRaw && Number(minConfidenceRaw) > 0 ? Number(minConfidenceRaw) : undefined;

  const conditions: Prisma.LeadOpportunityWhereInput[] = [{ company: { organizationId } }];
  if (country) conditions.push({ company: { headquartersCountry: country } });
  if (industry) conditions.push({ company: { industry } });
  if (service) conditions.push({ recommendedService: service });
  if (category) conditions.push({ category });
  if (statusFilter) conditions.push({ status: statusFilter });
  if (minConfidence !== undefined) conditions.push({ confidenceScore: { gte: minConfidence } });

  const where: Prisma.LeadOpportunityWhereInput = { AND: conditions };

  const [opportunities, countryRows, industryRows, categoryRows, statusCounts] = await Promise.all([
    prisma.leadOpportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            industry: true,
            headquartersCountry: true,
            _count: { select: { evidence: true } },
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
    prisma.leadOpportunity.findMany({
      where: { company: { organizationId } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
    Promise.all(
      STATUS_OPTIONS.map(async (s) => ({
        status: s,
        count: await prisma.leadOpportunity.count({ where: { company: { organizationId }, status: s } }),
      })),
    ),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            Every opportunity the AI Opportunity Engine has surfaced from your org&apos;s researched companies —
            a review/triage surface only. Nothing here sends outreach or triggers a campaign automatically;
            every action below is a deliberate, explicit click.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statusCounts.map(({ status, count }) => (
            <Link
              key={status}
              href={statusFilter === status ? "/dashboard/opportunities" : `/dashboard/opportunities?status=${status}`}
              className={`glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                statusFilter === status ? "ring-2 ring-primary" : ""
              }`}
            >
              <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[status]}</span>
              <span className="text-xl font-semibold tracking-tight text-foreground">
                <AnimatedCounter value={count} />
              </span>
            </Link>
          ))}
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/opportunities" method="GET">
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
                <label htmlFor="category" className="text-xs text-muted-foreground">
                  Opportunity type
                </label>
                <Select id="category" name="category" defaultValue={category ?? ""} className="w-48">
                  <option value="">All types</option>
                  {categoryRows.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="minConfidence" className="text-xs text-muted-foreground">
                  Confidence
                </label>
                <Select id="minConfidence" name="minConfidence" defaultValue={minConfidence ? String(minConfidence) : "0"} className="w-36">
                  {CONFIDENCE_THRESHOLD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="status" className="text-xs text-muted-foreground">
                  Status
                </label>
                <Select id="status" name="status" defaultValue={statusFilter ?? ""} className="w-44">
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
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
                href="/dashboard/opportunities"
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
                No opportunities match these filters. The AI Opportunity Engine only generates opportunities for
                companies with real CompanyIntelligence research already on file — research a company first, or
                widen the filters above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {opportunities.map((opportunity) => {
              const service = opportunity.recommendedService
                ? KVL_SERVICE_BY_ID.get(opportunity.recommendedService as KVLServiceId)
                : null;

              return (
                <Card glass key={opportunity.id} className="flex flex-col">
                  <CardContent className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="size-4" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{opportunity.company.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[opportunity.company.industry, opportunity.company.headquartersCountry].filter(Boolean).join(" · ") ||
                              "No profile details yet"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSNAME[opportunity.status]}`}
                      >
                        {STATUS_LABEL[opportunity.status]}
                      </span>
                    </div>

                    <div>
                      <p className="font-medium text-foreground">{opportunity.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{opportunity.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={service ? "accent" : "outline"}>{service ? service.label : "Unmatched service"}</Badge>
                      <Badge variant="outline">{opportunity.category}</Badge>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(opportunity.confidenceScore)}`}
                      >
                        {opportunity.confidenceScore}% confidence
                      </span>
                      <Badge variant="outline">
                        {opportunity.company._count.evidence} evidence item{opportunity.company._count.evidence === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    <div className="mt-auto border-t border-border pt-3">
                      <OpportunityActions opportunityId={opportunity.id} status={opportunity.status} showView />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Container>
    </main>
  );
}
