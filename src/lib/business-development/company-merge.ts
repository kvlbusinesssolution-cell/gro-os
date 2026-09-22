import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export interface MergeCompaniesResult {
  ok: boolean;
  error?: string;
  reassignedCounts?: Record<string, number>;
}

/**
 * Phase 24 (requirement #4, company merge safety) — the real merge
 * capability that was previously entirely missing (schema groundwork —
 * `mergedIntoId`/`mergedAt` — existed with zero code using it). A merge is
 * SOFT: the merge-away Company row is never deleted, only flagged
 * (`mergedIntoId`/`mergedAt`) and excluded from normal discovery/dedup
 * matching going forward (see dedup.ts) — its full history stays reachable
 * via the `mergedInto` relation, never silently lost.
 *
 * Every one of the 32 real foreign-key relations pointing at Company in
 * this schema (extracted directly from prisma/schema.prisma, not
 * hand-guessed — see this function's own test file for the verification
 * script) is reassigned from the merge-away company to the keeper inside a
 * single real Prisma transaction — either the whole merge succeeds or none
 * of it does, so a partial/corrupted merge state is impossible.
 *
 * Three relations have a real DB-level uniqueness constraint that a naive
 * bulk reassignment would violate if BOTH companies already have their own
 * row (IntentScore.companyId and LeadScore.companyId are 1:1 @unique;
 * WatchlistCompany has @@unique([watchlistId, companyId])) — those three
 * are handled specially below: the merge-away company's conflicting row is
 * dropped (not silently duplicated), everything else is reassigned. Every
 * other relation is a plain non-unique child record, reassigned directly.
 */
export async function mergeCompanies(
  organizationId: string,
  keepId: string,
  mergeAwayId: string,
  actorUserId: string | null,
): Promise<MergeCompaniesResult> {
  if (keepId === mergeAwayId) {
    return { ok: false, error: "Cannot merge a company into itself." };
  }

  const [keep, mergeAway] = await Promise.all([
    prisma.company.findUnique({ where: { id: keepId } }),
    prisma.company.findUnique({ where: { id: mergeAwayId } }),
  ]);

  if (!keep || keep.organizationId !== organizationId) {
    return { ok: false, error: "The company to keep was not found in your organization." };
  }
  if (!mergeAway || mergeAway.organizationId !== organizationId) {
    return { ok: false, error: "The company to merge away was not found in your organization." };
  }
  if (keep.mergedIntoId) {
    return { ok: false, error: "The company to keep has itself already been merged into another company." };
  }
  if (mergeAway.mergedIntoId) {
    return { ok: false, error: "That company has already been merged into another company." };
  }

  const reassignedCounts: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    // ---- 1:1-unique relations: drop the merge-away row if the keeper
    // already has one, otherwise reassign it.
    for (const model of ["intentScore", "leadScore"] as const) {
      const keeperHasOne = await (tx[model] as { findUnique: (args: unknown) => Promise<unknown> }).findUnique({
        where: { companyId: keepId },
      });
      if (keeperHasOne) {
        const deleted = await (tx[model] as { deleteMany: (args: unknown) => Promise<{ count: number }> }).deleteMany({
          where: { companyId: mergeAwayId },
        });
        reassignedCounts[`${model}_dropped_duplicate`] = deleted.count;
      } else {
        const updated = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
          where: { companyId: mergeAwayId },
          data: { companyId: keepId },
        });
        reassignedCounts[model] = updated.count;
      }
    }

    // ---- WatchlistCompany: @@unique([watchlistId, companyId]) — drop any
    // merge-away membership on a watchlist the keeper is already on, then
    // reassign the rest.
    const keeperWatchlistIds = (
      await tx.watchlistCompany.findMany({ where: { companyId: keepId }, select: { watchlistId: true } })
    ).map((w) => w.watchlistId);
    const droppedWatchlist = await tx.watchlistCompany.deleteMany({
      where: { companyId: mergeAwayId, watchlistId: { in: keeperWatchlistIds } },
    });
    reassignedCounts.watchlistCompany_dropped_duplicate = droppedWatchlist.count;
    const updatedWatchlist = await tx.watchlistCompany.updateMany({
      where: { companyId: mergeAwayId },
      data: { companyId: keepId },
    });
    reassignedCounts.watchlistCompany = updatedWatchlist.count;

    // ---- Every other real relation pointing at Company (plain, non-unique
    // child records) — straightforward bulk reassignment.
    const plainCompanyIdModels = [
      "lead",
      "deal",
      "task",
      "client",
      "project",
      "proposal",
      "quotation",
      "contract",
      "invoice",
      "revenueAttribution",
      "businessDocument",
      "companyIntelligence",
      "researchNote",
      "companyEvidence",
      "decisionMaker",
      "companyTimelineEvent",
      "websiteScan",
      "contact",
      "whatsAppConversation",
      "call",
      "conversationIntelligence",
      "rateNegotiation",
      "subscription",
      "leadOpportunity",
      "buyerPersona",
    ] as const;

    for (const model of plainCompanyIdModels) {
      const updated = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
        where: { companyId: mergeAwayId },
        data: { companyId: keepId },
      });
      reassignedCounts[model] = updated.count;
    }

    // ---- The 3 relations that use a differently-named FK column
    // (relatedCompanyId / linkedCompanyId) rather than companyId.
    const updatedReminder = await tx.reminder.updateMany({
      where: { relatedCompanyId: mergeAwayId },
      data: { relatedCompanyId: keepId },
    });
    reassignedCounts.reminder = updatedReminder.count;

    const updatedRecommendation = await tx.recommendation.updateMany({
      where: { relatedCompanyId: mergeAwayId },
      data: { relatedCompanyId: keepId },
    });
    reassignedCounts.recommendation = updatedRecommendation.count;

    const updatedDocument = await tx.document.updateMany({
      where: { linkedCompanyId: mergeAwayId },
      data: { linkedCompanyId: keepId },
    });
    reassignedCounts.document = updatedDocument.count;

    // ---- Flag the merge-away row — never deleted, real soft-merge.
    await tx.company.update({
      where: { id: mergeAwayId },
      data: { mergedIntoId: keepId, mergedAt: new Date() },
    });
  });

  await logAudit({
    userId: actorUserId,
    organizationId,
    action: "company.merged",
    metadata: { keepId, mergeAwayId, reassignedCounts },
  });

  return { ok: true, reassignedCounts };
}
