"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";
import type { OpportunityStatus } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/** Same "first stage by order, in this org's workspace" resolution as createDeal/convertLeadToDeal (src/app/dashboard/crm/_lib/deal-actions.ts). */
async function firstDealStage(organizationId: string) {
  return prisma.dealStage.findFirst({
    where: { workspace: { organizationId } },
    orderBy: { order: "asc" },
  });
}

function serviceLabel(serviceId: string | null): string | null {
  if (!serviceId) return null;
  return KVL_SERVICES.find((service) => service.id === serviceId)?.label ?? serviceId;
}

/**
 * Once an opportunity has been converted into a real Deal, this record's
 * status is effectively terminal from these three actions' point of view:
 * the Deal (not the LeadOpportunity) is now the source of truth for the
 * sales process, so re-dismissing/re-reviewing/re-adding it here would
 * either create a duplicate Deal or leave the opportunity's status
 * contradicting a Deal that still genuinely exists in the pipeline. Blocked
 * rather than silently allowed.
 */
function isTerminal(status: OpportunityStatus): boolean {
  return status === "ADDED_TO_CRM";
}

async function loadOpportunityInOrg(organizationId: string, opportunityId: string) {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: true },
  });
  if (!opportunity || opportunity.company.organizationId !== organizationId) return null;
  return opportunity;
}

export interface AddOpportunityToCrmResult extends ActionResult {
  dealId?: string;
}

/**
 * Headless core of addOpportunityToCrm — no session, everything past the
 * auth/membership check. Mirrors advanceSequence/advanceSequenceCore
 * (src/app/dashboard/outreach/_lib/sequence-actions.ts) and
 * logReply/logReplyCore (src/app/dashboard/outreach/_lib/reply-actions.ts)'s
 * exact auth-wrapper + headless-core split, kept here (rather than skipped)
 * because this app has no existing colocated *.test.ts for a "use server"
 * action file to model an alternative on — a real, confirmed gap this file
 * does not repeat.
 */
export async function addOpportunityToCrmCore(
  organizationId: string,
  userId: string,
  opportunityId: string,
): Promise<AddOpportunityToCrmResult> {
  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  if (isTerminal(opportunity.status)) {
    return { ok: false, error: "This opportunity has already been added to the CRM." };
  }

  const stage = await firstDealStage(organizationId);
  if (!stage) return { ok: false, error: "No deal pipeline stage configured for this organization." };

  const noteParts = [
    opportunity.description,
    opportunity.evidence ? `Evidence: ${opportunity.evidence}` : null,
    opportunity.recommendedService ? `Recommended service: ${serviceLabel(opportunity.recommendedService)}` : null,
    opportunity.serviceMatchReason ? `Why this service: ${opportunity.serviceMatchReason}` : null,
    opportunity.salesAngle ? `Sales angle: ${opportunity.salesAngle}` : null,
    opportunity.nextStep ? `Next step: ${opportunity.nextStep}` : null,
  ].filter((part): part is string => Boolean(part));

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      dealStageId: stage.id,
      companyId: opportunity.companyId,
      ownerUserId: userId,
      name: `${opportunity.company.name} — ${opportunity.title}`,
      value: opportunity.estimatedValue ?? null,
      services: opportunity.recommendedService ? [opportunity.recommendedService] : [],
      notes: noteParts.length > 0 ? noteParts.join("\n\n") : null,
    },
  });

  await prisma.leadOpportunity.update({
    where: { id: opportunity.id },
    data: { status: "ADDED_TO_CRM" },
  });

  await logAudit({
    userId,
    organizationId,
    action: "opportunities.added_to_crm",
    metadata: { opportunityId: opportunity.id, dealId: deal.id, companyId: opportunity.companyId },
  });

  revalidatePath("/dashboard/opportunities");
  revalidatePath("/dashboard/crm/deals");

  return { ok: true, dealId: deal.id };
}

/** Session-gated Server Action wrapper — the real "Add to CRM" button on the Opportunities UI. */
export async function addOpportunityToCrm(opportunityId: string): Promise<AddOpportunityToCrmResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return addOpportunityToCrmCore(membership.organizationId, userId, opportunityId);
}

/** Headless core of dismissOpportunity — see addOpportunityToCrmCore's doc for the split's rationale. */
export async function dismissOpportunityCore(organizationId: string, userId: string, opportunityId: string): Promise<ActionResult> {
  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  if (isTerminal(opportunity.status)) {
    return { ok: false, error: "This opportunity has already been added to the CRM and can no longer be dismissed." };
  }

  await prisma.leadOpportunity.update({ where: { id: opportunity.id }, data: { status: "DISMISSED" } });

  await logAudit({
    userId,
    organizationId,
    action: "opportunities.dismissed",
    metadata: { opportunityId: opportunity.id, companyId: opportunity.companyId },
  });

  revalidatePath("/dashboard/opportunities");
  return { ok: true };
}

/** Session-gated Server Action wrapper — the real "Dismiss" button on the Opportunities UI. */
export async function dismissOpportunity(opportunityId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return dismissOpportunityCore(membership.organizationId, userId, opportunityId);
}

/** Headless core of markOpportunityForReview — see addOpportunityToCrmCore's doc for the split's rationale. */
export async function markOpportunityForReviewCore(organizationId: string, userId: string, opportunityId: string): Promise<ActionResult> {
  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  if (isTerminal(opportunity.status)) {
    return { ok: false, error: "This opportunity has already been added to the CRM." };
  }

  await prisma.leadOpportunity.update({ where: { id: opportunity.id }, data: { status: "REVIEWED" } });

  await logAudit({
    userId,
    organizationId,
    action: "opportunities.marked_reviewed",
    metadata: { opportunityId: opportunity.id, companyId: opportunity.companyId },
  });

  revalidatePath("/dashboard/opportunities");
  return { ok: true };
}

/** Session-gated Server Action wrapper — the real "Mark reviewed" affordance on the Opportunities UI. */
export async function markOpportunityForReview(opportunityId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return markOpportunityForReviewCore(membership.organizationId, userId, opportunityId);
}
