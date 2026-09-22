import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { priorityQueueToCsv, type ExportPriorityQueueRow } from "@/lib/export/csv";
import { buildPriorityQueueOrderBy, buildPriorityQueueWhere, parsePriorityQueueFilters } from "@/app/dashboard/priority-queue/_lib/queries";
import { PRIORITY_LABEL, recommendedNextAction } from "@/app/dashboard/opportunities/_lib/opportunity-display";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

/**
 * CSV export for the Priority Queue — deliberately reuses
 * buildPriorityQueueWhere/buildPriorityQueueOrderBy (same file the page
 * itself queries with) so the exported rows are exactly what's on screen
 * for the filters/sort in the URL, never a separately-drifting "export all"
 * dump.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await resolveActiveMembership(userId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const filters = parsePriorityQueueFilters(Object.fromEntries(url.searchParams));
  const where = buildPriorityQueueWhere(membership.organizationId, filters, userId);
  const orderBy = buildPriorityQueueOrderBy(filters);

  const opportunities = await prisma.leadOpportunity.findMany({
    where,
    orderBy,
    include: {
      company: {
        select: {
          name: true,
          industry: true,
          headquartersCountry: true,
          leadScore: { select: { overallScore: true } },
          intentScore: { select: { score: true } },
        },
      },
      owner: { select: { name: true, email: true } },
    },
  });

  const rows: ExportPriorityQueueRow[] = opportunities.map((o) => {
    const service = o.recommendedService ? KVL_SERVICE_BY_ID.get(o.recommendedService as KVLServiceId) : null;
    return {
      companyName: o.company.name,
      industry: o.company.industry,
      country: o.company.headquartersCountry,
      opportunityTitle: o.title,
      leadScore: o.company.leadScore?.overallScore ?? null,
      intentScore: o.company.intentScore?.score ?? null,
      opportunityScore: o.opportunityScore,
      priority: o.priority ? PRIORITY_LABEL[o.priority] : null,
      status: o.status,
      ownerName: o.owner?.name ?? o.owner?.email ?? null,
      nextAction: recommendedNextAction({ status: o.status, nextStep: o.nextStep, recommendedServiceLabel: service?.label ?? null }),
      createdAt: o.createdAt,
    };
  });

  const csv = priorityQueueToCsv(rows);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="priority-queue-${dateStamp}.csv"`,
    },
  });
}
