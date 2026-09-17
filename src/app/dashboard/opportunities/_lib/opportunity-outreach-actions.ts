"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { generateEmailDraft } from "@/lib/outreach/draft-generator";
import { matchDecisionMakerForOpportunity, type DecisionMakerCandidate } from "@/lib/business-development/decision-maker-matching";
import { resolveOutreachContact } from "@/lib/business-development/decision-maker-outreach";
import type { SequenceStepInput } from "@/lib/validations/outreach";
import type { Prisma } from "@/generated/prisma/client";
import {
  OUTREACH_CAMPAIGN_NAME,
  OUTREACH_SEQUENCE_NAME,
  OUTREACH_SEQUENCE_NAME_LINKEDIN,
  DEFAULT_SEQUENCE_STEPS,
  DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST,
} from "./opportunity-outreach-constants";

/**
 * Phase 5: the "smarter on-ramp" from a Phase 2-4 `LeadOpportunity` straight
 * into the existing outreach pipeline (sequence-actions.ts /
 * approval-actions.ts) — NOT a new pipeline. Every draft this creates lands
 * at `EmailDraft.status: "DRAFT"` exactly like any other draft; a human
 * still has to Review -> Approve -> Send it via the existing UI. This file
 * only wires together already-built pieces:
 *  - matchDecisionMakerForOpportunity (decision-maker-matching.ts, Phase 3)
 *    to pick the right person,
 *  - resolveOutreachContact (decision-maker-outreach.ts, Phase 5, read-only
 *    import per instructions) to turn them into a real Contact with a real
 *    (never-fabricated) email,
 *  - a find-or-create Campaign/Sequence pair implementing the spec's Day
 *    0/2/5/9/15 cadence,
 *  - generateEmailDraft (draft-generator.ts) to produce the first real
 *    draft.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/**
 * Mirrors opportunity-actions.ts's private (not exported) loadOpportunityInOrg
 * — same org-ownership check (opportunity.company.organizationId ===
 * organizationId) — extended to also pull the company's DecisionMakers,
 * which that helper doesn't need and this one does.
 */
async function loadOpportunityWithDecisionMakers(organizationId: string, opportunityId: string) {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: { include: { decisionMakers: true } } },
  });
  if (!opportunity || opportunity.company.organizationId !== organizationId) return null;
  return opportunity;
}

function sequenceStepsFor(channel: "EMAIL" | "LINKEDIN"): SequenceStepInput[] {
  return channel === "LINKEDIN" ? DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST : DEFAULT_SEQUENCE_STEPS;
}

function sequenceNameFor(channel: "EMAIL" | "LINKEDIN"): string {
  return channel === "LINKEDIN" ? OUTREACH_SEQUENCE_NAME_LINKEDIN : OUTREACH_SEQUENCE_NAME;
}

/** Find-or-create the one standing, human-approved-by-default campaign every opportunity-sourced outreach in this org gets enrolled into. Deliberately `approvalMode: "MANUAL"` — unlike KVL's own AUTOMATIC campaign (kvl-sector-discovery-job.ts's ensureKvlOutreachCampaign), the Phase 5 spec explicitly requires a human in the loop for this on-ramp. */
async function ensureOutreachCampaign(organizationId: string, createdByUserId: string) {
  const existing = await prisma.campaign.findFirst({ where: { organizationId, name: OUTREACH_CAMPAIGN_NAME } });
  if (existing) return existing;

  return prisma.campaign.create({
    data: {
      organizationId,
      name: OUTREACH_CAMPAIGN_NAME,
      type: "STANDARD",
      status: "ACTIVE",
      approvalMode: "MANUAL",
      goal: "Convert AI-detected LeadOpportunities into real outreach — every draft still goes through the existing human Review -> Approve -> Send pipeline.",
      createdByUserId,
    },
  });
}

/**
 * Find-or-create the one standing Day 0/2/5/9/15 sequence every
 * opportunity-sourced outreach in this org is enrolled into for the given
 * first-touch channel. EMAIL and LINKEDIN each get their own find-or-create
 * key (a distinct Sequence.name) so an org can have both an email-first and
 * a LinkedIn-first default sequence side by side, without one overwriting
 * the other.
 */
async function ensureOutreachSequence(organizationId: string, campaignId: string, channel: "EMAIL" | "LINKEDIN") {
  const name = sequenceNameFor(channel);
  const existing = await prisma.sequence.findFirst({ where: { organizationId, name } });
  if (existing) return existing;

  return prisma.sequence.create({
    data: {
      organizationId,
      campaignId,
      name,
      steps: sequenceStepsFor(channel) as unknown as Prisma.InputJsonValue,
    },
  });
}

export interface ConvertOpportunityToOutreachResult extends ActionResult {
  contactId?: string;
  sequenceId?: string;
  draftId?: string;
}

/**
 * Headless core of convertOpportunityToOutreach — no session, everything
 * past the auth/membership check. Mirrors addOpportunityToCrmCore/
 * addOpportunityToCrm's exact split (opportunity-actions.ts, same
 * directory).
 *
 * Deliberately does NOT call the existing session-gated `enrollContact`
 * (sequence-actions.ts) directly: `enrollContact` calls `auth()` and
 * re-derives the organization from the session itself, which would force a
 * real request/session onto what must stay a headless function (called here
 * with an already-verified organizationId/userId, and directly by tests with
 * neither). Instead this calls `generateEmailDraft` (draft-generator.ts)
 * directly for the sequence's first content step — the exact same function
 * `enrollContact` itself calls internally — so the generated draft is
 * identical to what `enrollContact` would have produced; only the
 * session-handling wrapper around it is bypassed. This is the one deviation
 * from a literal "call enrollContact" instruction, made necessary by
 * enrollContact's own session-gated design.
 */
export async function convertOpportunityToOutreachCore(
  organizationId: string,
  userId: string,
  opportunityId: string,
  channel: "EMAIL" | "LINKEDIN" = "EMAIL",
): Promise<ConvertOpportunityToOutreachResult> {
  const opportunity = await loadOpportunityWithDecisionMakers(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  const candidates: DecisionMakerCandidate[] = opportunity.company.decisionMakers.map((dm) => ({
    id: dm.id,
    name: dm.name,
    role: dm.role,
    source: dm.source,
    sourceUrl: dm.sourceUrl,
    confidence: dm.confidence,
  }));

  const match = matchDecisionMakerForOpportunity(opportunity.recommendedService, candidates);
  if (!match) {
    return { ok: false, error: "No public decision-maker identified for this company yet — run decision-maker discovery first." };
  }

  const resolved = await resolveOutreachContact(match.decisionMaker.id);
  if ("error" in resolved) {
    // resolveOutreachContact already made the real, honest decision here
    // (real email found / honest company fallback / hard error) — pass its
    // error straight through rather than inventing a different one.
    return { ok: false, error: resolved.error };
  }
  const { contactId } = resolved;

  const campaign = await ensureOutreachCampaign(organizationId, userId);
  const sequence = await ensureOutreachSequence(organizationId, campaign.id, channel);

  await prisma.campaignContact.createMany({
    data: [{ campaignId: campaign.id, contactId }],
    skipDuplicates: true,
  });

  const firstStep = sequenceStepsFor(channel)[0];

  try {
    const draft = await generateEmailDraft({
      contactId,
      purpose: firstStep.purpose ?? (channel === "LINKEDIN" ? "CONNECTION_REQUEST" : "INTRODUCTION"),
      tone: firstStep.tone ?? "PROFESSIONAL",
      channel,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      sequenceStepIndex: 0,
    });

    await logAudit({
      userId,
      organizationId,
      action: "opportunities.converted_to_outreach",
      metadata: {
        opportunityId,
        companyId: opportunity.companyId,
        decisionMakerId: match.decisionMaker.id,
        contactId,
        campaignId: campaign.id,
        sequenceId: sequence.id,
        draftId: draft.id,
      },
    });

    revalidatePath("/dashboard/opportunities");
    revalidatePath("/dashboard/outreach");

    return { ok: true, contactId, sequenceId: sequence.id, draftId: draft.id };
  } catch (error) {
    // Contact/Campaign/Sequence/CampaignContact are real, durable rows
    // regardless of whether the AI draft itself could be generated — still
    // report their ids so a caller (and the audit trail) knows real
    // outreach setup happened even when the draft step failed.
    await logAudit({
      userId,
      organizationId,
      action: "opportunities.converted_to_outreach_draft_failed",
      metadata: {
        opportunityId,
        companyId: opportunity.companyId,
        decisionMakerId: match.decisionMaker.id,
        contactId,
        campaignId: campaign.id,
        sequenceId: sequence.id,
      },
    });

    if (error instanceof AINotConnectedError) {
      return {
        ok: false,
        error: "AI is not connected — no ANTHROPIC_API_KEY is configured for this environment.",
        contactId,
        sequenceId: sequence.id,
      };
    }
    if (error instanceof AIBillingError || isAIBillingError(error)) {
      return {
        ok: false,
        error: "AI is connected but the account has no API credits — add credits at console.anthropic.com/settings/billing.",
        contactId,
        sequenceId: sequence.id,
      };
    }
    console.error("[opportunity-outreach-actions] draft generation failed:", error);
    return {
      ok: false,
      error: "Contact and sequence were set up, but the first draft could not be generated. Please try again.",
      contactId,
      sequenceId: sequence.id,
    };
  }
}

/** Session-gated Server Action wrapper — the real "Convert to Outreach" affordance on the Opportunities UI. `channel` picks the first-touch channel (defaults to EMAIL); Day 2/5/9/15 follow-ups stay EMAIL either way. */
export async function convertOpportunityToOutreach(
  opportunityId: string,
  channel: "EMAIL" | "LINKEDIN" = "EMAIL",
): Promise<ConvertOpportunityToOutreachResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return convertOpportunityToOutreachCore(membership.organizationId, userId, opportunityId, channel);
}
