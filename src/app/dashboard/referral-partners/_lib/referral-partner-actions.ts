"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createReferralPartnerSchema, type CreateReferralPartnerInput } from "@/lib/validations/referral-partner";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Same role-gating convention as decideApproval (outreach/_lib/approval-actions.ts) and every other status-changing action this session built. */
const MANAGER_ROLES = new Set(["OWNER", "ADMIN"]);

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function loadPartnerInOrg(organizationId: string, partnerId: string) {
  const partner = await prisma.referralPartner.findUnique({ where: { id: partnerId } });
  if (!partner || partner.organizationId !== organizationId) return null;
  return partner;
}

/**
 * Headless core of activateReferralPartner — no session, everything past
 * the auth/membership/role check. Mirrors addOpportunityToCrmCore's
 * auth-wrapper + headless-core split (opportunities/_lib/opportunity-actions.ts).
 */
export async function activateReferralPartnerCore(
  organizationId: string,
  userId: string,
  partnerId: string,
): Promise<ActionResult> {
  const partner = await loadPartnerInOrg(organizationId, partnerId);
  if (!partner) return { ok: false, error: "Referral partner not found." };

  if (partner.status === "ACTIVE") {
    return { ok: false, error: "This partner is already active." };
  }

  await prisma.referralPartner.update({ where: { id: partner.id }, data: { status: "ACTIVE" } });

  await logAudit({
    userId,
    organizationId,
    action: "referral_partners.activated",
    metadata: { partnerId: partner.id, previousStatus: partner.status },
  });

  revalidatePath("/dashboard/referral-partners");
  revalidatePath(`/dashboard/referral-partners/${partner.id}`);
  return { ok: true };
}

/**
 * Session-gated Server Action wrapper — the real "Activate" button on a
 * CANDIDATE partner (AI-discovered, not yet recruited). OWNER/ADMIN only,
 * same as decideApproval — recruiting a real referral relationship is a
 * business decision, not a routine triage click.
 */
export async function activateReferralPartner(partnerId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!MANAGER_ROLES.has(membership.role)) {
    return { ok: false, error: "Only owners and admins can activate a referral partner." };
  }

  return activateReferralPartnerCore(membership.organizationId, userId, partnerId);
}

async function loadCommissionInOrg(organizationId: string, commissionId: string) {
  const commission = await prisma.partnerCommission.findUnique({
    where: { id: commissionId },
    include: { partner: true },
  });
  if (!commission || commission.partner.organizationId !== organizationId) return null;
  return commission;
}

/** Headless core of markPartnerCommissionPaid — see activateReferralPartnerCore's doc for the split's rationale. */
export async function markPartnerCommissionPaidCore(
  organizationId: string,
  userId: string,
  commissionId: string,
): Promise<ActionResult> {
  const commission = await loadCommissionInOrg(organizationId, commissionId);
  if (!commission) return { ok: false, error: "Commission not found." };

  if (commission.status === "PAID") {
    return { ok: false, error: "This commission has already been marked as paid." };
  }

  await prisma.partnerCommission.update({
    where: { id: commission.id },
    data: { status: "PAID", paidAt: new Date() },
  });

  await logAudit({
    userId,
    organizationId,
    action: "referral_partners.commission_marked_paid",
    metadata: {
      commissionId: commission.id,
      partnerId: commission.partnerId,
      dealId: commission.dealId,
      amount: commission.amount,
    },
  });

  revalidatePath(`/dashboard/referral-partners/${commission.partnerId}`);
  return { ok: true };
}

/**
 * Session-gated Server Action wrapper — the real "Mark as paid" button per
 * PENDING PartnerCommission row on the partner detail page (the "Payout
 * status" the spec asks for). OWNER/ADMIN only, same role gate as the
 * pre-existing global-Partner payout-marking flow's own operator-only
 * check (src/app/admin/payouts/), confirming actual funds moved outside
 * this app — this pass doesn't call any real payout API, same honest
 * scope as that page.
 */
export async function markPartnerCommissionPaid(commissionId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!MANAGER_ROLES.has(membership.role)) {
    return { ok: false, error: "Only owners and admins can mark a commission as paid." };
  }

  return markPartnerCommissionPaidCore(membership.organizationId, userId, commissionId);
}

export interface CreateReferralPartnerResult extends ActionResult {
  partnerId?: string;
}

/**
 * Headless core of createReferralPartner — no session, everything past the
 * auth/membership/role check. Same Core/wrapper split as
 * activateReferralPartnerCore's doc comment explains.
 *
 * Unlike the AI Partner Discovery job (discoverPotentialPartners, always
 * creates `status: "CANDIDATE"` rows to be reviewed), a human manually
 * adding a partner they already know is, by definition, already a real
 * relationship — so this creates the row straight into ACTIVE, with
 * `discoverySource: "Manually added"` so it stays honestly distinguishable
 * in the data from an AI-discovered row (see the detail page's "AI Partner
 * Discovery evidence" block, which only ever renders for a real
 * discoverySource string).
 */
export async function createReferralPartnerCore(
  organizationId: string,
  userId: string,
  input: CreateReferralPartnerInput,
): Promise<CreateReferralPartnerResult> {
  const parsed = createReferralPartnerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the partner details." };
  }

  const partner = await prisma.referralPartner.create({
    data: {
      organizationId,
      name: parsed.data.name,
      type: parsed.data.type ?? null,
      status: "ACTIVE",
      email: parsed.data.email || null,
      website: parsed.data.website || null,
      notes: parsed.data.notes || null,
      commissionRatePercent: parsed.data.commissionRatePercent ?? 10,
      discoverySource: "Manually added",
      createdByUserId: userId,
    },
  });

  await logAudit({
    userId,
    organizationId,
    action: "referral_partners.created",
    metadata: { partnerId: partner.id, name: partner.name },
  });

  revalidatePath("/dashboard/referral-partners");
  return { ok: true, partnerId: partner.id };
}

/**
 * Session-gated Server Action wrapper — the real "Add Partner" form on
 * /dashboard/referral-partners (add-partner-dialog.tsx). OWNER/ADMIN only,
 * same role gate as activateReferralPartner — recruiting a real referral
 * relationship is a business decision, not a routine triage click.
 */
export async function createReferralPartner(input: CreateReferralPartnerInput): Promise<CreateReferralPartnerResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!MANAGER_ROLES.has(membership.role)) {
    return { ok: false, error: "Only owners and admins can add a referral partner." };
  }

  return createReferralPartnerCore(membership.organizationId, userId, input);
}
