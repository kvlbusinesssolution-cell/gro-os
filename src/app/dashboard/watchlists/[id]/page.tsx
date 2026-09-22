import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, Building2, Globe, Mail } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { LeadScoreBadge } from "@/app/dashboard/_components/lead-score-badge";
import { IntentScoreBadge } from "@/app/dashboard/_components/intent-score-badge";
import { DeleteWatchlistButton, RemoveFromWatchlistButton } from "../_components/watchlist-detail-actions";

const STATUS_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  PROSPECT: "outline",
  LEAD: "accent",
  CLIENT: "default",
  CHURNED: "secondary",
};

export default async function WatchlistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { id } = await params;
  const { sort } = await searchParams;
  const { membership } = await requireActiveMembership(`/dashboard/watchlists/${id}`);

  // Phase 28 (buying intent — Watchlist integration): real sort by
  // IntentScore.score, matching the same real sortKey pattern Priority
  // Queue already uses (priority-queue/_lib/queries.ts). Default stays
  // "most recently added first" — sorting by intent is opt-in.
  const sortByIntent = sort === "intentScore";

  const watchlist = await prisma.watchlist.findUnique({
    where: { id },
    include: {
      companies: {
        orderBy: sortByIntent ? { company: { intentScore: { score: "desc" } } } : { addedAt: "desc" },
        include: { company: { include: { leadScore: true, intentScore: true } } },
      },
    },
  });

  if (!watchlist || watchlist.organizationId !== membership.organizationId) {
    notFound();
  }

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link
          href="/dashboard/watchlists"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Watchlists
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
              <Bookmark className="size-5 text-primary" /> {watchlist.name}
            </h1>
            {watchlist.description && <p className="text-sm text-muted-foreground">{watchlist.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {watchlist.companies.length > 0 && (
              <Link
                href={sortByIntent ? `/dashboard/watchlists/${id}` : `/dashboard/watchlists/${id}?sort=intentScore`}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {sortByIntent ? "Sort: Intent score (highest first)" : "Sort by intent score"}
              </Link>
            )}
            <DeleteWatchlistButton watchlistId={watchlist.id} watchlistName={watchlist.name} />
          </div>
        </div>

        {watchlist.companies.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Building2 className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No companies here yet. Add companies from the Companies list or a Company Profile.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watchlist.companies.map(({ company }) => (
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
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1">
                          <Badge variant={STATUS_VARIANT[company.status]}>{company.status}</Badge>
                          <RemoveFromWatchlistButton watchlistId={watchlist.id} companyId={company.id} />
                        </div>
                        {company.leadScore && (
                          <LeadScoreBadge band={company.leadScore.band} score={company.leadScore.overallScore} />
                        )}
                        {company.intentScore && (
                          <IntentScoreBadge band={company.intentScore.band} score={company.intentScore.score} />
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
