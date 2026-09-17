"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { logActivity } from "@/lib/activity";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { generateProposalSections } from "@/lib/ai/document-engine";
import { generateTrackingToken, createDocumentVersion } from "@/lib/documents";
import { buildProposalContext } from "@/lib/business-development/proposal-context";
import { flattenProposalSections } from "@/app/dashboard/proposal/_lib/proposal-blueprint";

export interface GenerateProposalFromOpportunityResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
  proposalId?: string;
  dealId?: string | null;
}

function describeAIError(error: unknown): GenerateProposalFromOpportunityResult {
  if (error instanceof AINotConnectedError) {
    return { ok: false, errorKind: "not_connected", error: "AI is not connected — no ANTHROPIC_API_KEY is configured for this environment." };
  }
  if (error instanceof AIBillingError || isAIBillingError(error)) {
    return { ok: false, errorKind: "billing", error: "AI is connected but the account has no API credits — add credits at console.anthropic.com/settings/billing." };
  }
  console.error("[proposal-generation] AI call failed (generating proposal from opportunity):", error);
  return { ok: false, errorKind: "generic", error: "Something went wrong generating the proposal. Please try again." };
}

async function loadOpportunityInOrg(organizationId: string, opportunityId: string) {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: true },
  });
  if (!opportunity || opportunity.company.organizationId !== organizationId) return null;
  return opportunity;
}

/**
 * Headless core of generateProposalFromOpportunity — no session, everything
 * past the auth/membership check. Mirrors addOpportunityToCrmCore's
 * auth-wrapper + headless-core split
 * (src/app/dashboard/opportunities/_lib/opportunity-actions.ts) so this can
 * also be called from a workflow node or background job later without a
 * browser session.
 *
 * "Do not invent budget" enforcement: the only place this function ever
 * sets a numeric `Proposal.value` is `opportunity.estimatedValue ?? null`
 * (line below) — the exact same discipline addOpportunityToCrmCore uses for
 * `Deal.value`. The AI-authored `sections.commercialStructure` field is a
 * narrative string describing pricing structure/options in prose; its
 * content is never parsed, summed, or otherwise turned into a number here.
 */
export async function generateProposalFromOpportunityCore(
  organizationId: string,
  userId: string,
  opportunityId: string,
): Promise<GenerateProposalFromOpportunityResult> {
  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  if (opportunity.status === "DISMISSED") {
    return { ok: false, error: "This opportunity was dismissed and cannot be turned into a proposal." };
  }

  if (!checkRateLimit(`proposal-from-opportunity:${userId}`, { limit: 15, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, errorKind: "generic", error: "Too many proposals requested — wait a few minutes and try again." };
  }

  const agent = await prisma.aIAgentInstance.findUnique({
    where: { organizationId_type: { organizationId, type: "PROPOSAL" } },
  });
  if (!agent) return { ok: false, error: "Your Proposal agent isn't set up yet." };

  // Only link to a Deal that genuinely already exists for this company — a
  // real Deal is only created once this opportunity was added to the CRM
  // (addOpportunityToCrmCore). Never fabricate a Deal here; Deal creation is
  // Phase 2's job, not this action's.
  let dealId: string | null = null;
  if (opportunity.status === "ADDED_TO_CRM") {
    const deal = await prisma.deal.findFirst({
      where: { organizationId, companyId: opportunity.companyId },
      orderBy: { createdAt: "desc" },
    });
    dealId = deal?.id ?? null;
  }

  const context = await buildProposalContext(opportunityId);
  const title = `${opportunity.company.name} — ${opportunity.title}`;

  try {
    const sections = await generateProposalSections({
      agentId: agent.id,
      agentName: agent.name,
      title,
      brief: opportunity.description,
      companyContext: context ?? undefined,
    });
    const content = flattenProposalSections(sections);

    // Real number or null, never fabricated — see the function doc comment above.
    const value = opportunity.estimatedValue ?? null;

    const proposal = await prisma.proposal.create({
      data: {
        organizationId,
        companyId: opportunity.companyId,
        dealId,
        title,
        content,
        sections,
        estimation: sections.estimation,
        value,
        generatedByAgentId: agent.id,
        createdByUserId: userId,
        // ProposalStatus's default/initial value — this app's real "needs
        // human review before sending" state. Sending is already gated
        // behind checkApprovalGate (src/lib/approval-engine.ts) for
        // DocumentKind.PROPOSAL, so no separate/duplicate review flag is
        // introduced here.
        status: "DRAFT",
        trackingToken: generateTrackingToken(),
      },
    });

    await createDocumentVersion({
      organizationId,
      docKind: "PROPOSAL",
      docId: proposal.id,
      title: proposal.title,
      content,
      changedByUserId: userId,
      changeNote: `AI-generated draft from opportunity "${opportunity.title}"`,
    });

    await prisma.aIAgentInstance.update({ where: { id: agent.id }, data: { completedTasksCount: { increment: 1 } } });

    await logActivity({
      organizationId,
      type: "COMPLETED_WORK",
      description: `${agent.name} drafted proposal "${proposal.title}" from a qualified opportunity.`,
      actorAgentId: agent.id,
      metadata: { proposalId: proposal.id, opportunityId: opportunity.id, dealId: dealId ?? undefined },
    });
    await logAudit({
      userId,
      organizationId,
      action: "proposal.generated_from_opportunity",
      metadata: { proposalId: proposal.id, opportunityId: opportunity.id, dealId },
    });
    await notifyOrganizationOwners({
      organizationId,
      type: "EMAIL_READY",
      title: "Proposal ready",
      message: `"${proposal.title}" is drafted from a qualified opportunity and ready to review.`,
    });

    revalidatePath("/dashboard/opportunities");
    revalidatePath("/dashboard/proposal");
    revalidatePath("/dashboard/proposal/proposals");
    if (dealId) revalidatePath(`/dashboard/crm/deals/${dealId}`);

    return { ok: true, proposalId: proposal.id, dealId };
  } catch (error) {
    return describeAIError(error);
  }
}

/** Session-gated Server Action wrapper — the real "Generate Proposal" button on the Opportunities UI. */
export async function generateProposalFromOpportunity(opportunityId: string): Promise<GenerateProposalFromOpportunityResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return generateProposalFromOpportunityCore(membership.organizationId, userId, opportunityId);
}
