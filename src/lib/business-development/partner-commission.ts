import { prisma } from "@/lib/prisma";

/**
 * Phase 8 (Partner & Referral Client Acquisition Engine) commission
 * generation — completes the "Deal -> Revenue -> Commission" tail of the
 * "Partner -> Referral -> Lead -> Qualification -> Opportunity -> Deal ->
 * Revenue -> Commission" flow.
 *
 * Deliberately its OWN standalone module rather than an addition to
 * src/lib/partners/commissions.ts, which generates the DIFFERENT
 * `Commission` model (Phase 18's platform-wide SaaS reseller program, keyed
 * off Organization.referredByPartnerId + BillingAccount payments) — see
 * ReferralPartner's schema doc comment for the full distinction. This
 * function generates the NEW `PartnerCommission` model instead, off a real
 * won Deal's own value.
 *
 * INTENDED CALL SITE: src/app/dashboard/crm/_lib/deal-actions.ts's
 * `moveDealStage`, inside its existing `if (targetStage.name === "Won")`
 * block — mirrors that block's own storeAgentMemory try/catch discipline:
 * a commission-generation failure must never break the real deal-won
 * transition.
 *
 * Behavior: looks up the Deal's Company. If that Company has no
 * referralPartnerId, or the partner isn't ACTIVE, this is a silent no-op —
 * most deals have no referral partner at all, which is the normal case, not
 * an error. If it does, computes `amount = deal.value * (commissionRatePercent
 * / 100)` — a real number derived directly from the deal's own stored value,
 * never fabricated, and 0/skipped entirely when `deal.value` is null (no
 * synthetic default). Idempotent via the `(partnerId, dealId)` unique
 * constraint: a deal that's re-saved into "Won" (or whose DEAL_STAGE_CHANGED
 * trigger fires more than once) never creates a second commission for the
 * same partner+deal pair — it's a genuine no-op on retry, not an upsert that
 * would overwrite a since-approved/paid commission's amount.
 */
export async function generatePartnerCommissionForDeal(dealId: string): Promise<{ created: boolean; amount: number | null }> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      value: true,
      companyId: true,
      company: {
        select: {
          referralPartnerId: true,
          referralPartner: { select: { id: true, status: true, commissionRatePercent: true } },
        },
      },
    },
  });
  if (!deal || !deal.companyId || !deal.company?.referralPartnerId) return { created: false, amount: null };

  const partner = deal.company.referralPartner;
  if (!partner || partner.status !== "ACTIVE") return { created: false, amount: null };

  if (deal.value == null || deal.value <= 0) return { created: false, amount: null };

  const existing = await prisma.partnerCommission.findUnique({
    where: { partnerId_dealId: { partnerId: partner.id, dealId: deal.id } },
  });
  if (existing) return { created: false, amount: existing.amount };

  const amount = deal.value * (partner.commissionRatePercent / 100);
  if (amount <= 0) return { created: false, amount: null };

  await prisma.partnerCommission.create({
    data: { partnerId: partner.id, dealId: deal.id, amount, status: "PENDING" },
  });

  return { created: true, amount };
}
