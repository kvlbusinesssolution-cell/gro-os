import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";

const TREND_DAYS = 30;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sparkline-style bar row — single hue per metric (never two metrics sharing one axis), height scaled to that metric's own max so a quiet listing's bars are still legible. */
function TrendBars({ label, values, colorClass }: { label: string; values: { date: string; value: number }[]; colorClass: string }) {
  const max = Math.max(1, ...values.map((v) => v.value));
  const total = values.reduce((sum, v) => sum + v.value, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span className="text-xs text-muted-foreground">{total} in last {TREND_DAYS} days</span>
      </div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`${label} over the last ${TREND_DAYS} days, total ${total}`}>
        {values.map((v) => (
          <div
            key={v.date}
            title={`${v.date}: ${v.value}`}
            className={`min-w-[3px] flex-1 rounded-t ${colorClass}`}
            style={{ height: `${Math.max(2, (v.value / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export default async function ListingAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/analytics`);

  const listing = await prisma.businessListing.findUnique({ where: { id } });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (TREND_DAYS - 1));
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.businessListingDailyStat.findMany({
    where: { businessListingId: id, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(rows.map((r) => [dayKey(r.date), r]));

  const days: { date: string; views: number; leads: number }[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dayKey(d);
    const row = byDate.get(key);
    days.push({ date: key, views: row?.viewCount ?? 0, leads: row?.leadCount ?? 0 });
  }

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analytics — {listing.businessName}</h1>
          <p className="text-sm text-muted-foreground">Views and leads trend, plus lifetime totals.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Lifetime views", value: listing.viewCount },
            { label: "Lifetime leads", value: listing.leadCount },
            { label: "Average rating", value: listing.reviewCount > 0 ? listing.averageRating.toFixed(1) : "—" },
            { label: "Reviews", value: listing.reviewCount },
          ].map((tile) => (
            <Card key={tile.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="text-2xl font-semibold text-foreground">{tile.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Last {TREND_DAYS} days</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <TrendBars label="Views" values={days.map((d) => ({ date: d.date, value: d.views }))} colorClass="bg-primary" />
            <TrendBars label="Leads" values={days.map((d) => ({ date: d.date, value: d.leads }))} colorClass="bg-emerald-500" />

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">View as table</summary>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr>
                      <th className="p-2 font-medium text-muted-foreground">Date</th>
                      <th className="p-2 font-medium text-muted-foreground">Views</th>
                      <th className="p-2 font-medium text-muted-foreground">Leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.date} className="border-t border-border">
                        <td className="p-2">{d.date}</td>
                        <td className="p-2">{d.views}</td>
                        <td className="p-2">{d.leads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
