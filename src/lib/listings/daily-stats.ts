import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** Midnight UTC for "today" — the stable grain BusinessListingDailyStat rows are keyed on. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Upserts today's row for one listing, incrementing the given counter.
 * Additive alongside BusinessListing.viewCount/leadCount (never replaces
 * them — those stay the lifetime totals) so the owner-facing analytics
 * dashboard (src/app/dashboard/business-growth/[id]/analytics/page.tsx) can
 * chart a real trend. Best-effort: a failure here must never block the
 * caller's own mutation (recordListingView/captureLead/requestQuotes).
 */
export async function incrementDailyStat(
  businessListingId: string,
  field: "viewCount" | "leadCount",
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    const date = todayUtc();
    await client.businessListingDailyStat.upsert({
      where: { businessListingId_date: { businessListingId, date } },
      create: { businessListingId, date, viewCount: field === "viewCount" ? 1 : 0, leadCount: field === "leadCount" ? 1 : 0 },
      update: { [field]: { increment: 1 } },
    });
  } catch (error) {
    console.error("[listings/daily-stats] incrementDailyStat failed:", error);
  }
}
