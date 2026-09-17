import Link from "next/link";
import { Building2, Users2, Mail, Globe, Bookmark, Map as MapIcon } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { LeadScoreBadge } from "../_components/lead-score-badge";
import { WatchlistPicker } from "../_components/watchlist-picker";
import { AddToCrmButton } from "../_components/add-to-crm-button";
import { CompanyForm } from "./_components/company-form";
import { CompanyStatsStrip } from "./_components/company-stats-strip";
import { ExportMenu } from "./_components/export-menu";
import { getCompanyStats } from "@/lib/lead-analytics";
import { CsvImportButton } from "../crm/_components/csv-import-button";
import { importCompaniesFile } from "../crm/_lib/import-export";

const STATUS_LABEL: Record<string, string> = {
  PROSPECT: "Prospect",
  LEAD: "Lead",
  CLIENT: "Client",
  CHURNED: "Churned",
};

const STATUS_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  PROSPECT: "outline",
  LEAD: "accent",
  CLIENT: "default",
  CHURNED: "secondary",
};

export default async function CompaniesPage() {
  const { membership } = await requireActiveMembership("/dashboard/companies");

  const [companies, watchlists, stats, referralPartners] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { leads: true, clients: true, projects: true } },
        leadScore: true,
        watchlistEntries: { select: { watchlistId: true } },
      },
    }),
    prisma.watchlist.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCompanyStats(membership.organizationId),
    // Only ACTIVE referral partners are attributable — a CANDIDATE (AI-discovered,
    // not yet recruited) hasn't been confirmed as a real relationship yet. See
    // resolveReferralPartnerId's doc comment in companies/actions.ts.
    prisma.referralPartner.findMany({
      where: { organizationId: membership.organizationId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Companies</h1>
            <p className="text-sm text-muted-foreground">
              A real directory of every organization you deal with — prospects, leads, and clients — linked
              automatically to their leads, projects, and proposals.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/companies/map" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <MapIcon className="size-4" /> Map View
            </Link>
            <Link
              href="/dashboard/watchlists"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Bookmark className="size-4" /> Watchlists
            </Link>
            <ExportMenu />
            <CsvImportButton label="Import CSV/Excel" action={importCompaniesFile} />
            <CompanyForm referralPartners={referralPartners} />
          </div>
        </div>

        <CompanyStatsStrip stats={stats} currency={membership.organization.currency} />

        {companies.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Building2 className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No companies yet. Add one manually, or find real ones automatically with Lead Finder / Client Finder.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
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
                          {company.industry && (
                            <p className="text-xs text-muted-foreground">{company.industry}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[company.status]}>{STATUS_LABEL[company.status]}</Badge>
                          <WatchlistPicker
                            companyId={company.id}
                            watchlists={watchlists}
                            memberOf={company.watchlistEntries.map((w) => w.watchlistId)}
                          />
                        </div>
                        {company.leadScore && (
                          <LeadScoreBadge band={company.leadScore.band} score={company.leadScore.overallScore} />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {company.website && (
                        <span className="flex items-center gap-1.5 truncate">
                          <Globe className="size-3.5 shrink-0" /> {company.website}
                        </span>
                      )}
                      {company.email && (
                        <span className="flex items-center gap-1.5 truncate">
                          <Mail className="size-3.5 shrink-0" /> {company.email}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5">
                          <Users2 className="size-3.5" /> {company._count.leads} leads
                        </span>
                        <span>{company._count.clients} clients</span>
                        <span>{company._count.projects} projects</span>
                      </div>
                      <AddToCrmButton companyId={company.id} alreadyInCrm={company._count.leads > 0} />
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
