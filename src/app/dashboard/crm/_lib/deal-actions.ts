"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { evaluateAutomationRules } from "@/lib/automation-engine";
import { fireWorkflowTrigger } from "@/lib/workflows/triggers";
import { convertWonDealToProject } from "@/lib/projects/deal-conversion";
import { storeAgentMemory } from "@/lib/ai/agent-runtime";
import { generatePartnerCommissionForDeal } from "@/lib/business-development/partner-commission";
import { dealSchema, type DealInput } from "@/lib/validations/crm";
import { emitWebhookEvent } from "@/lib/webhooks/event-bus";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
}

async function resolveDealInOrg(userId: string, dealId: string) {
  const membership = await resolveActiveMembership(userId);
  if (!membership) return null;
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { dealStage: true } });
  if (!deal || deal.organizationId !== membership.organizationId) return null;
  return { membership, deal };
}

async function firstDealStage(organizationId: string) {
  return prisma.dealStage.findFirst({
    where: { workspace: { organizationId } },
    orderBy: { order: "asc" },
  });
}

async function assertBelongsToOrg(organizationId: string, input: DealInput["companyId"] | DealInput["contactId"], kind: "company" | "contact") {
  if (!input) return true;
  if (kind === "company") {
    const company = await prisma.company.findUnique({ where: { id: input } });
    return !!company && company.organizationId === organizationId;
  }
  const contact = await prisma.contact.findUnique({ where: { id: input } });
  return !!contact && contact.organizationId === organizationId;
}

export interface CreateDealResult extends ActionResult {
  dealId?: string;
}

/** Creates a Deal in the org's first (leftmost) DealStage unless dealStageId is given. */
export async function createDeal(input: DealInput, dealStageId?: string): Promise<CreateDealResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the deal details." };
  }

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const organizationId = membership.organizationId;

  if (!(await assertBelongsToOrg(organizationId, parsed.data.companyId, "company"))) {
    return { ok: false, error: "Selected company was not found." };
  }
  if (!(await assertBelongsToOrg(organizationId, parsed.data.contactId, "contact"))) {
    return { ok: false, error: "Selected contact was not found." };
  }

  try {
    let stage = dealStageId ? await prisma.dealStage.findUnique({ where: { id: dealStageId } }) : null;
    if (!stage || stage.workspaceId !== (await prisma.workspace.findUnique({ where: { organizationId } }))?.id) {
      stage = await firstDealStage(organizationId);
    }
    if (!stage) return { ok: false, error: "No pipeline stages configured for this organization yet." };

    let ownerUserId = parsed.data.ownerUserId || null;
    if (ownerUserId) {
      const ownerMembership = await prisma.membership.findFirst({ where: { userId: ownerUserId, organizationId, status: "ACTIVE" } });
      if (!ownerMembership) ownerUserId = null;
    }

    const deal = await prisma.deal.create({
      data: {
        organizationId,
        dealStageId: stage.id,
        companyId: parsed.data.companyId || null,
        contactId: parsed.data.contactId || null,
        ownerUserId,
        name: parsed.data.name,
        value: parsed.data.value ?? null,
        probability: parsed.data.probability ?? null,
        expectedCloseDate: parsed.data.expectedCloseDate ?? null,
        priority: parsed.data.priority,
        products: parsed.data.products ?? [],
        services: parsed.data.services ?? [],
        notes: parsed.data.notes || null,
      },
    });

    await logActivity({
      organizationId,
      type: "SYSTEM_EVENT",
      description: `${session.user?.name ?? "A team member"} created deal "${deal.name}".`,
      actorUserId: userId,
      metadata: { dealId: deal.id },
    });
    await logAudit({ userId, organizationId, action: "crm.deal_created", metadata: { dealId: deal.id } });
    // Phase 12 — real stage-transition log (src/lib/forecast/deal-probability.ts
    // reads this for historical stage-conversion analysis; starts empty, never
    // backfilled for transitions that happened before this existed).
    await prisma.dealStageHistory.create({
      data: { organizationId, dealId: deal.id, toStageId: stage.id, toStageName: stage.name, changedByUserId: userId },
    });

    revalidatePath("/dashboard/crm/deals");
    revalidatePath("/dashboard/crm");
    return { ok: true, dealId: deal.id };
  } catch (error) {
    console.error("[crm] createDeal failed:", error);
    return { ok: false, error: "Something went wrong creating the deal. Please try again." };
  }
}

export async function updateDeal(dealId: string, input: DealInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the deal details." };
  }

  const resolved = await resolveDealInOrg(userId, dealId);
  if (!resolved) return { ok: false, error: "Deal not found." };
  const organizationId = resolved.membership.organizationId;

  if (!(await assertBelongsToOrg(organizationId, parsed.data.companyId, "company"))) {
    return { ok: false, error: "Selected company was not found." };
  }
  if (!(await assertBelongsToOrg(organizationId, parsed.data.contactId, "contact"))) {
    return { ok: false, error: "Selected contact was not found." };
  }

  try {
    let ownerUserId = parsed.data.ownerUserId || null;
    if (ownerUserId) {
      const ownerMembership = await prisma.membership.findFirst({ where: { userId: ownerUserId, organizationId, status: "ACTIVE" } });
      if (!ownerMembership) ownerUserId = null;
    }

    await prisma.deal.update({
      where: { id: dealId },
      data: {
        companyId: parsed.data.companyId || null,
        contactId: parsed.data.contactId || null,
        ownerUserId,
        name: parsed.data.name,
        value: parsed.data.value ?? null,
        probability: parsed.data.probability ?? null,
        expectedCloseDate: parsed.data.expectedCloseDate ?? null,
        priority: parsed.data.priority,
        products: parsed.data.products ?? [],
        services: parsed.data.services ?? [],
        notes: parsed.data.notes || null,
      },
    });

    await logAudit({ userId, organizationId, action: "crm.deal_updated", metadata: { dealId } });
    revalidatePath("/dashboard/crm/deals");
    revalidatePath(`/dashboard/crm/deals/${dealId}`);
    revalidatePath("/dashboard/crm");
    return { ok: true };
  } catch (error) {
    console.error("[crm] updateDeal failed:", error);
    return { ok: false, error: "Something went wrong updating the deal. Please try again." };
  }
}

export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDealInOrg(userId, dealId);
  if (!resolved) return { ok: false, error: "Deal not found." };

  await prisma.deal.delete({ where: { id: dealId } });
  await logAudit({ userId, organizationId: resolved.membership.organizationId, action: "crm.deal_deleted", metadata: { dealId } });
  revalidatePath("/dashboard/crm/deals");
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

/**
 * Moves a Deal to a different DealStage within the same workspace — powers
 * the Deals Kanban's drag-and-drop columns. Mirrors moveLeadStage in
 * ../actions.ts exactly, plus fires the new DEAL_STAGE_CHANGED/DEAL_WON/
 * DEAL_LOST automation triggers (moveLeadStage has no automation hook
 * today; this is additive, not a change to that function).
 */
export async function moveDealStage(dealId: string, targetStageId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  try {
    const [deal, targetStage] = await Promise.all([
      prisma.deal.findUnique({ where: { id: dealId }, include: { dealStage: { include: { workspace: true } } } }),
      prisma.dealStage.findUnique({ where: { id: targetStageId }, include: { workspace: true } }),
    ]);

    if (!deal || deal.organizationId !== membership.organizationId) {
      return { ok: false, error: "Deal not found." };
    }
    if (!targetStage || targetStage.workspace.organizationId !== membership.organizationId) {
      return { ok: false, error: "Pipeline stage not found." };
    }

    const data: { dealStageId: string; lostReason?: string | null } = { dealStageId: targetStageId };
    if (targetStage.name !== "Lost") data.lostReason = deal.lostReason;

    await prisma.deal.update({ where: { id: dealId }, data });

    // Phase 12 — real stage-transition log (see createDeal's own call above).
    await prisma.dealStageHistory.create({
      data: {
        organizationId: membership.organizationId,
        dealId,
        fromStageId: deal.dealStageId,
        fromStageName: deal.dealStage.name,
        toStageId: targetStageId,
        toStageName: targetStage.name,
        changedByUserId: userId,
      },
    });

    await logActivity({
      organizationId: membership.organizationId,
      type: "SYSTEM_EVENT",
      description: `${session.user?.name ?? "A team member"} moved deal "${deal.name}" to ${targetStage.name}.`,
      actorUserId: userId,
      metadata: { dealId, targetStageId },
    });

    await evaluateAutomationRules(membership.organizationId, "DEAL_STAGE_CHANGED", {
      subject: deal.name,
      dealId,
    });
    await fireWorkflowTrigger(membership.organizationId, "DEAL_STAGE_CHANGED", {
      dealId,
      dealName: deal.name,
      value: deal.value,
      companyId: deal.companyId,
      targetStageId,
      targetStageName: targetStage.name,
    });

    if (targetStage.name === "Won") {
      await notifyOrganizationOwners({
        organizationId: membership.organizationId,
        type: "CRM_EVENT",
        title: "Deal won",
        message: `${deal.name} moved to Won${deal.value ? ` (${deal.value})` : ""}.`,
      });
      await evaluateAutomationRules(membership.organizationId, "DEAL_WON", { subject: deal.name, dealId });
      await fireWorkflowTrigger(membership.organizationId, "DEAL_WON", { dealId, dealName: deal.name, value: deal.value, companyId: deal.companyId });
      void emitWebhookEvent(membership.organizationId, "DEAL_WON", { dealId, dealName: deal.name, value: deal.value, companyId: deal.companyId });
      await convertWonDealToProject(dealId);

      // Real memory write for the org's Sales agent — a genuine won-deal
      // outcome it can recall in future negotiations/reviews. Fire-and-forget,
      // same discipline as fireWorkflowTrigger/notifyOrganizationOwners above:
      // a memory-store failure must never break the real deal-won transition.
      try {
        const salesAgent = await prisma.aIAgentInstance.findFirst({ where: { organizationId: membership.organizationId, type: "SALES" } });
        if (salesAgent) {
          await storeAgentMemory(
            salesAgent.id,
            membership.organizationId,
            "PAST_DECISION",
            `Deal "${deal.name}"${deal.value ? ` (value ${deal.value})` : ""} was won.`,
            "DEAL",
            dealId,
          );
        }
      } catch (memoryError) {
        console.error("[crm] storeAgentMemory for DEAL_WON failed:", memoryError);
      }

      // Phase 8 (Partner & Referral Client Acquisition Engine) — completes
      // the Deal -> Revenue -> Commission tail when this deal's Company was
      // referred by an ACTIVE ReferralPartner. Silent no-op for the (normal,
      // majority) case of no referral partner. Same fire-and-forget
      // discipline as storeAgentMemory above: never breaks the real
      // deal-won transition.
      try {
        await generatePartnerCommissionForDeal(dealId);
      } catch (commissionError) {
        console.error("[crm] generatePartnerCommissionForDeal for DEAL_WON failed:", commissionError);
      }
    } else if (targetStage.name === "Lost") {
      await notifyOrganizationOwners({
        organizationId: membership.organizationId,
        type: "CRM_EVENT",
        title: "Deal lost",
        message: `${deal.name} moved to Lost.`,
      });
      await evaluateAutomationRules(membership.organizationId, "DEAL_LOST", { subject: deal.name, dealId });
      await fireWorkflowTrigger(membership.organizationId, "DEAL_LOST", { dealId, dealName: deal.name, value: deal.value, companyId: deal.companyId, lostReason: deal.lostReason });
      void emitWebhookEvent(membership.organizationId, "DEAL_LOST", { dealId, dealName: deal.name, value: deal.value, companyId: deal.companyId, lostReason: deal.lostReason });
    }

    revalidatePath("/dashboard/crm/deals");
    revalidatePath("/dashboard/crm");
    return { ok: true };
  } catch (error) {
    console.error("[crm] moveDealStage failed:", error);
    return { ok: false, error: "Something went wrong moving the deal. Please try again." };
  }
}

export async function setDealLostReason(dealId: string, lostReason: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDealInOrg(userId, dealId);
  if (!resolved) return { ok: false, error: "Deal not found." };

  await prisma.deal.update({ where: { id: dealId }, data: { lostReason: lostReason.trim() || null } });
  revalidatePath(`/dashboard/crm/deals/${dealId}`);
  return { ok: true };
}

export interface ConvertLeadResult extends ActionResult {
  dealId?: string;
}

/**
 * Converts a Lead into a first-class Deal in the enterprise pipeline — the
 * Lead row itself is left untouched (it keeps powering Lead Finder's
 * top-of-funnel view); this just creates a linked Deal in the DealStage
 * pipeline's first stage.
 */
export async function convertLeadToDeal(leadId: string): Promise<ConvertLeadResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const organizationId = membership.organizationId;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { pipelineStage: { include: { workspace: true } } },
  });
  if (!lead || lead.pipelineStage.workspace.organizationId !== organizationId) {
    return { ok: false, error: "Lead not found." };
  }

  try {
    const stage = await firstDealStage(organizationId);
    if (!stage) return { ok: false, error: "No pipeline stages configured for this organization yet." };

    const deal = await prisma.deal.create({
      data: {
        organizationId,
        dealStageId: stage.id,
        companyId: lead.companyId,
        sourceLeadId: lead.id,
        name: lead.name,
        value: lead.estimatedValue,
      },
    });

    await logActivity({
      organizationId,
      type: "SYSTEM_EVENT",
      description: `${session.user?.name ?? "A team member"} converted lead "${lead.name}" into a deal.`,
      actorUserId: userId,
      metadata: { leadId, dealId: deal.id },
    });
    await logAudit({ userId, organizationId, action: "crm.lead_converted_to_deal", metadata: { leadId, dealId: deal.id } });

    revalidatePath("/dashboard/crm/deals");
    revalidatePath("/dashboard/crm/pipeline");
    revalidatePath("/dashboard/crm");
    return { ok: true, dealId: deal.id };
  } catch (error) {
    console.error("[crm] convertLeadToDeal failed:", error);
    return { ok: false, error: "Something went wrong converting the lead. Please try again." };
  }
}

export async function requestDealApproval(dealId: string, approverUserId: string, note?: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDealInOrg(userId, dealId);
  if (!resolved) return { ok: false, error: "Deal not found." };
  const organizationId = resolved.membership.organizationId;

  const approverMembership = await prisma.membership.findFirst({ where: { userId: approverUserId, organizationId, status: "ACTIVE" } });
  if (!approverMembership) return { ok: false, error: "That approver could not be found." };

  try {
    const task = await prisma.task.create({
      data: {
        organizationId,
        dealId,
        type: "APPROVAL",
        title: `Approve deal: ${resolved.deal.name}`,
        description: note || `${session.user?.name ?? "A team member"} requested approval for "${resolved.deal.name}".`,
        assignedByUserId: userId,
        assignedToUserId: approverUserId,
        priority: "HIGH",
      },
    });

    await notifyOrganizationOwners({
      organizationId,
      type: "APPROVAL_REQUESTED",
      title: "Deal approval requested",
      message: `${session.user?.name ?? "A team member"} requested approval for "${resolved.deal.name}".`,
    });

    await logActivity({
      organizationId,
      type: "SYSTEM_EVENT",
      description: `${session.user?.name ?? "A team member"} requested approval for deal "${resolved.deal.name}".`,
      actorUserId: userId,
      metadata: { dealId, taskId: task.id },
    });

    revalidatePath(`/dashboard/crm/deals/${dealId}`);
    revalidatePath("/dashboard/crm/tasks");
    return { ok: true };
  } catch (error) {
    console.error("[crm] requestDealApproval failed:", error);
    return { ok: false, error: "Something went wrong requesting approval. Please try again." };
  }
}
