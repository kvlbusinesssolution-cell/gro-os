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
import { DiscoveryBucketBadge } from "./_components/discovery-bucket-badge";
import type { CompanySource, Prisma } from "@/generated/prisma/client";

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
  country?: string;
  industry?: string;
  source?: string;
  technology?: string;
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
  const country = params.country?.trim() || undefined;
  const industry = params.industry?.trim() || undefined;
  const source = params.source?.trim() || undefined;
  const technology = params.technology?.trim() || undefined;
  const from = params.from?.trim() || undefined;
  const to = params.to?.trim() || undefined;

  const conditions: Prisma.CompanyWhereInput[] = [{ organizationId }];
  if (statusFilter) conditions.push(buildDiscoveryBucketWhere(statusFilter, now));
  if (country) conditions.push({ headquartersCountry: country });
  if (industry) conditions.push({ industry });
  if (source) conditions.push({ OR: [{ source: source as CompanySource }, { discoverySources: { has: source } }] });
  if (technology) conditions.push({ technologies: { has: technology } });
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) conditions.push({ lastDiscoveredAt: { gte: fromDate } });
  }
  if (to) {
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(toDate.getTime())) conditions.push({ lastDiscoveredAt: { lte: toDate } });
  }

  const where: Prisma.CompanyWhereInput = { AND: conditions };

  const [companies, countryRows, industryRows, bucketCounts] = await Promise.all([
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Company Discovery</h1>
          <p className="text-sm text-muted-foreground">
            Every company your org has discovered — manually, via Lead/Client Finder, or the autonomous
            discovery job — grouped by real research status straight off the database. Nothing here is
            client-side-filtered from a fixed page; every filter below runs as a real query.
          </p>
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
                <Input id="technology" name="technology" defaultValue={technology ?? ""} placeholder="e.g. Shopify" className="w-40" />
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
