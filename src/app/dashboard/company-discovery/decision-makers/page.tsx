import Link from "next/link";
import { Users2, ArrowLeft, RotateCcw } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { buildDecisionMakerSearchWhere } from "@/lib/business-development/decision-maker-search";
import { toStringArray, parseNumberParam } from "@/lib/business-development/company-discovery-filters";
import type { DecisionMakerRole } from "@/generated/prisma/client";

const ROLE_OPTIONS: DecisionMakerRole[] = [
  "FOUNDER",
  "CO_FOUNDER",
  "CEO",
  "DIRECTOR",
  "CTO",
  "COO",
  "MARKETING_HEAD",
  "SALES_HEAD",
  "BUSINESS_DEVELOPMENT_HEAD",
  "IT_HEAD",
  "PRODUCT_HEAD",
];

interface DecisionMakerSearchParams {
  name?: string;
  role?: string | string[];
  industry?: string | string[];
  country?: string | string[];
  minConfidence?: string;
}

/**
 * Phase 15 — standalone decision-maker/contact search over the existing
 * DecisionMaker model (real role/industry/country/confidence filters, all
 * server-side). Never invents a decision-maker; only searches what
 * enrichment has already discovered and stored with a real source.
 */
export default async function DecisionMakerSearchPage({
  searchParams,
}: {
  searchParams: Promise<DecisionMakerSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/company-discovery/decision-makers");
  const organizationId = membership.organizationId;

  const name = params.name?.trim() || undefined;
  const roles = toStringArray(params.role) as DecisionMakerRole[];
  const industries = toStringArray(params.industry);
  const countries = toStringArray(params.country);
  const minConfidence = parseNumberParam(params.minConfidence);

  const where = buildDecisionMakerSearchWhere(organizationId, { name, roles, industries, countries, minConfidence });

  const [decisionMakers, industryRows, countryRows] = await Promise.all([
    prisma.decisionMaker.findMany({
      where,
      orderBy: { verifiedAt: "desc" },
      take: 200,
      include: { company: { select: { id: true, name: true, industry: true, headquartersCountry: true } } },
    }),
    prisma.company.findMany({
      where: { organizationId, industry: { not: null } },
      select: { industry: true },
      distinct: ["industry"],
      orderBy: { industry: "asc" },
    }),
    prisma.company.findMany({
      where: { organizationId, headquartersCountry: { not: null } },
      select: { headquartersCountry: true },
      distinct: ["headquartersCountry"],
      orderBy: { headquartersCountry: "asc" },
    }),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link
            href="/dashboard/company-discovery"
            className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to Company Discovery
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Decision-Maker Search</h1>
          <p className="text-sm text-muted-foreground">
            Real decision-makers already discovered by enrichment, searchable by title, industry, country and
            source confidence — every filter runs as a real database query, capped at 200 results per search.
          </p>
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/company-discovery/decision-makers" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="name" className="text-xs text-muted-foreground">
                  Name
                </label>
                <Input id="name" name="name" defaultValue={name ?? ""} placeholder="e.g. Sharma" className="w-40" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="role" className="text-xs text-muted-foreground">
                  Title/Role <span className="text-[10px]">(Ctrl/Cmd-click for OR)</span>
                </label>
                <Select id="role" name="role" multiple defaultValue={roles} className="h-auto min-h-11 w-48">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="industry" className="text-xs text-muted-foreground">
                  Company industry
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
                <label htmlFor="country" className="text-xs text-muted-foreground">
                  Company country
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
                <label htmlFor="minConfidence" className="text-xs text-muted-foreground">
                  Min. confidence
                </label>
                <Input
                  id="minConfidence"
                  name="minConfidence"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  defaultValue={minConfidence ?? ""}
                  placeholder="0.0–1.0"
                  className="w-28"
                />
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Search
              </button>
              <Link
                href="/dashboard/company-discovery/decision-makers"
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Link>
            </form>
          </CardContent>
        </Card>

        {decisionMakers.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Users2 className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No decision-makers match these filters yet. Decision-makers are found by AI Company Research —
                run it from a company&apos;s detail page to discover more.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decisionMakers.map((dm) => (
              <Link key={dm.id} href={`/dashboard/companies/${dm.companyId}`}>
                <Card glass className="h-full transition-transform duration-150 hover:-translate-y-0.5">
                  <CardContent className="flex flex-col gap-2 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{dm.name}</p>
                      <Badge variant="secondary">{dm.role.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {dm.company.name}
                      {dm.company.industry && ` · ${dm.company.industry}`}
                      {dm.company.headquartersCountry && ` · ${dm.company.headquartersCountry}`}
                    </p>
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                      <span>Source: {dm.source}</span>
                      <span>Confidence: {Math.round(dm.confidence * 100)}%</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
