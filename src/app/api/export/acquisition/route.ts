import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { parseAcquisitionDateRange } from "@/app/dashboard/analytics/_lib/acquisition-display";
import { computeAcquisitionOverview } from "@/lib/analytics/acquisition-funnel";
import { acquisitionOverviewToCsv } from "@/lib/export/acquisition-export";

/**
 * Auth-gated CSV export of the Acquisition Overview's bySource/byIndustry/
 * byCountry/byService breakdown tables (/dashboard/analytics's "Acquisition
 * Overview" section) — same auth + membership-resolution pattern as
 * /api/export/campaigns, and the exact `?from=&to=` convention the page's
 * own date-range filter uses, so exporting always matches whatever range is
 * currently on screen.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await resolveActiveMembership(userId);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 404 });

  const url = new URL(request.url);
  const dateRange = parseAcquisitionDateRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);

  const overview = await computeAcquisitionOverview(membership.organizationId, dateRange);
  const csv = acquisitionOverviewToCsv(overview);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="acquisition-overview-${dateStamp}.csv"`,
    },
  });
}
