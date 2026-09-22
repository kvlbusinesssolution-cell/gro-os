import Link from "next/link";
import { Building2, Globe, RotateCcw } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { LeadScoreBadge } from "../_components/lead-score-badge";
import {
  DISCOVERY_BUCKETS,
  DISCOVERY_BUCKET_LABEL,
  DISCOVERY_BUCKET_DESCRIPTION,
  buildDiscoveryBucketWhere,
  classifyCompanyBuckets,
  type DiscoveryBucket,
} from "@/lib/business-development/discovery-buckets";
import { buildCompanyDiscoveryWhere, parseNumberParam, toStringArray } from "@/lib/business-development/company-discovery-filters";
import { DiscoveryBucketBadge } from "./_components/discovery-bucket-badge";
import type { CompanySource } from "@/generated/prisma/client";

const SOURCE_OPTIONS: CompanySource[] = ["MANUAL", "LEAD_FINDER", "CLIENT_FINDER", "WEBSITE_SCANNER", "AUTO_DISCOVERY"];

function isDiscoveryBucket(value: string | undefined): value is DiscoveryBucket {
  return !!value && (DISCOVERY_BUCKETS as readonly string[]).includes(value);
}

function timeAgo(date: Date, now: Date): string {
  const ms = now.getTime() - date.getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

interface DiscoveryPageSearchParams {
  status?: string;
  country?: string | string[];
  industry?: string | string[];
  source?: string;
  technology?: string;
  technologyMode?: string;
  employeeMin?: string;
  employeeMax?: string;
  revenueMin?: string;
  revenueMax?: string;
  fundingStage?: string;
  state?: string;
  city?: string;
  from?: string;
  to?: string;
}

export default async function CompanyDiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<DiscoveryPageSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/company-discovery");
  const organizationId = membership.organizationId;
  const now = new Date();

  const statusFilter = isDiscoveryBucket(params.status) ? params.status : undefined;
  const countries = toStringArray(params.country);
  const industries = toStringArray(params.industry);
  const source = params.source?.trim() || undefined;
  const technology = params.technology?.trim() || undefined;
  const technologyMode = params.technologyMode === "exclude" ? "exclude" : "include";
  const employeeMin = parseNumberParam(params.employeeMin);
  const employeeMax = parseNumberParam(params.employeeMax);
  const revenueMin = parseNumberParam(params.revenueMin);
  const revenueMax = parseNumberParam(params.revenueMax);
  const fundingStage = params.fundingStage?.trim() || undefined;
  const state = params.state?.trim() || undefined;
  const city = params.city?.trim() || undefined;
  const from = params.from?.trim() || undefined;
  const to = params.to?.trim() || undefined;
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : undefined;

  const where = buildCompanyDiscoveryWhere(
    organizationId,
    {
      statusFilter,
      countries,
      industries,
      source,
      technology,
      technologyMode,
      employeeMin,
      employeeMax,
      revenueMin,
      revenueMax,
      fundingStage,
      state,
      city,
      from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
      to: toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
    },
    buildDiscoveryBucketWhere,
    now,
  );

  const [companies, countryRows, industryRows, fundingStageRows, bucketCounts] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { lastDiscoveredAt: "desc" },
      include: {
        _count: { select: { intelligenceRuns: true, evidence: true } },
        leadScore: { select: { id: true, band: true, overallScore: true } },
        intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.company.findMany({
      where: { organizationId, headquartersCountry: { not: null } },
      select: { headquartersCountry: true },
      distinct: ["headquartersCountry"],
      orderBy: { headquartersCountry: "asc" },
    }),
    prisma.company.findMany({
      where: { organizationId, industry: { not: null } },
      select: { industry: true },
      distinct: ["industry"],
      orderBy: { industry: "asc" },
    }),
    prisma.company.findMany({
      where: { organizationId, fundingStage: { not: null } },
      select: { fundingStage: true },
      distinct: ["fundingStage"],
      orderBy: { fundingStage: "asc" },
    }),
    Promise.all(
      DISCOVERY_BUCKETS.map(async (bucket) => ({
        bucket,
        count: await prisma.company.count({ where: { organizationId, ...buildDiscoveryBucketWhere(bucket, now) } }),
      })),
    ),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Company Discovery</h1>
            <p className="text-sm text-muted-foreground">
              Every company your org has discovered — manually, via Lead/Client Finder, or the autonomous
              discovery job — grouped by real research status straight off the database. Nothing here is
              client-side-filtered from a fixed page; every filter below runs as a real query.
            </p>
          </div>
          <Link
            href="/dashboard/company-discovery/decision-makers"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Search decision-makers
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {bucketCounts.map(({ bucket, count }) => (
            <Link
              key={bucket}
              href={statusFilter === bucket ? "/dashboard/company-discovery" : `/dashboard/company-discovery?status=${bucket}`}
              className={`glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                statusFilter === bucket ? "ring-2 ring-primary" : ""
              }`}
              title={DISCOVERY_BUCKET_DESCRIPTION[bucket]}
            >
              <span className="text-[11px] text-muted-foreground">{DISCOVERY_BUCKET_LABEL[bucket]}</span>
              <span className="text-xl font-semibold tracking-tight text-foreground">
                <AnimatedCounter value={count} />
              </span>
            </Link>
          ))}
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/company-discovery" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="status" className="text-xs text-muted-foreground">
                  Research status
                </label>
                <Select id="status" name="status" defaultValue={statusFilter ?? ""} className="w-52">
                  <option value="">All statuses</option>
                  {DISCOVERY_BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {DISCOVERY_BUCKET_LABEL[b]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="country" className="text-xs text-muted-foreground">
                  Country <span className="text-[10px]">(Ctrl/Cmd-click for OR)</span>
                </label>
                <Select id="country" name="country" multiple defaultValue={countries} className="h-auto min-h-11 w-44">
                  {countryRows.map((c) => (
                    <option key={c.headquartersCountry} value={c.headquartersCountry!}>
                      {c.headquartersCountry}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="industry" className="text-xs text-muted-foreground">
                  Industry <span className="text-[10px]">(Ctrl/Cmd-click for OR)</span>
                </label>
                <Select id="industry" name="industry" multiple defaultValue={industries} className="h-auto min-h-11 w-44">
                  {industryRows.map((i) => (
                    <option key={i.industry} value={i.industry!}>
                      {i.industry}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="source" className="text-xs text-muted-foreground">
                  Source
                </label>
                <Select id="source" name="source" defaultValue={source ?? ""} className="w-44">
                  <option value="">All sources</option>
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="technology" className="text-xs text-muted-foreground">
                  Technology
                </label>
                <div className="flex items-center gap-1.5">
                  <Input id="technology" name="technology" defaultValue={technology ?? ""} placeholder="e.g. Shopify" className="w-32" />
                  <Select id="technologyMode" name="technologyMode" defaultValue={technologyMode} className="w-24" title="Include (has) or exclude (NOT) this technology">
                    <option value="include">has</option>
                    <option value="exclude">NOT</option>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="employeeMin" className="text-xs text-muted-foreground">
                  Employees
                </label>
                <div className="flex items-center gap-1.5">
                  <Input id="employeeMin" name="employeeMin" type="number" min="0" defaultValue={employeeMin ?? ""} placeholder="Min" className="w-20" />
                  <Input id="employeeMax" name="employeeMax" type="number" min="0" defaultValue={employeeMax ?? ""} placeholder="Max" className="w-20" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="revenueMin" className="text-xs text-muted-foreground">
                  Revenue
                </label>
                <div className="flex items-center gap-1.5">
                  <Input id="revenueMin" name="revenueMin" type="number" min="0" defaultValue={revenueMin ?? ""} placeholder="Min" className="w-24" />
                  <Input id="revenueMax" name="revenueMax" type="number" min="0" defaultValue={revenueMax ?? ""} placeholder="Max" className="w-24" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="fundingStage" className="text-xs text-muted-foreground">
                  Funding stage
                </label>
                <Select id="fundingStage" name="fundingStage" defaultValue={fundingStage ?? ""} className="w-40">
                  <option value="">Any funding stage</option>
                  {fundingStageRows.map((f) => (
                    <option key={f.fundingStage} value={f.fundingStage!}>
                      {f.fundingStage}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="state" className="text-xs text-muted-foreground">
                  State
                </label>
                <Input id="state" name="state" defaultValue={state ?? ""} placeholder="e.g. Maharashtra" className="w-36" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="city" className="text-xs text-muted-foreground">
                  City
                </label>
                <Input id="city" name="city" defaultValue={city ?? ""} placeholder="e.g. Pune" className="w-32" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="from" className="text-xs text-muted-foreground">
                  Discovered from
                </label>
                <Input id="from" name="from" type="date" defaultValue={from ?? ""} className="w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="to" className="text-xs text-muted-foreground">
                  Discovered to
                </label>
                <Input id="to" name="to" type="date" defaultValue={to ?? ""} className="w-40" />
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Apply filters
              </button>
              <Link
                href="/dashboard/company-discovery"
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Link>
            </form>
          </CardContent>
        </Card>

        {companies.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Building2 className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No companies match these filters. Try Lead Finder / Client Finder, or widen the filters above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => {
              const buckets = classifyCompanyBuckets(
                {
                  sourceCount: company.sourceCount,
                  lastDiscoveredAt: company.lastDiscoveredAt,
                  intelligenceRunCount: company._count.intelligenceRuns,
                  latestIntelligenceRunAt: company.intelligenceRuns[0]?.createdAt ?? null,
                  evidenceCount: company._count.evidence,
                  hasLeadScore: !!company.leadScore,
                },
                now,
              );

              return (
                <Link key={company.id} href={`/dashboard/companies/${company.id}`}>
                  <Card glass className="h-full transition-transform duration-150 hover:-translate-y-0.5">
                    <CardContent className="flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Building2 className="size-4" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{company.name}</p>
                            {company.industry && <p className="text-xs text-muted-foreground">{company.industry}</p>}
                          </div>
                        </div>
                        {company.leadScore && (
                          <LeadScoreBadge band={company.leadScore.band} score={company.leadScore.overallScore} />
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {buckets.map((b) => (
                          <DiscoveryBucketBadge key={b} bucket={b} />
                        ))}
                      </div>

                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {company.website && (
                          <span className="flex items-center gap-1.5 truncate">
                            <Globe className="size-3.5 shrink-0" /> {company.website}
                          </span>
                        )}
                        {company.headquartersCountry && <span>{company.headquartersCountry}</span>}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                        <span>
                          {company.sourceCount} source{company.sourceCount === 1 ? "" : "s"}
                          {company.discoverySources.length > 0 && ` · ${company.discoverySources.join(", ")}`}
                        </span>
                        <span>{timeAgo(company.lastDiscoveredAt, now)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </Container>
    </main>
  );
}
