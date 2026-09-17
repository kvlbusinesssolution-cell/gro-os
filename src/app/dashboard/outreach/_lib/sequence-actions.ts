"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { generateEmailDraft } from "@/lib/outreach/draft-generator";
import { sequenceSchema, type SequenceInput, type SequenceStepInput } from "@/lib/validations/outreach";
import type { DraftChannel, DraftPurpose, EmailTone, EmailDraft, Prisma } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
}

function describeAIError(error: unknown): ActionResult {
  if (error instanceof AINotConnectedError) {
    return { ok: false, errorKind: "not_connected", error: "AI is not connected — no ANTHROPIC_API_KEY is configured for this environment." };
  }
  if (error instanceof AIBillingError || isAIBillingError(error)) {
    return { ok: false, errorKind: "billing", error: "AI is connected but the account has no API credits — add credits at console.anthropic.com/settings/billing." };
  }
  console.error("[outreach] AI call failed:", error);
  return { ok: false, errorKind: "generic", error: "Something went wrong. Please try again." };
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

export interface CreateSequenceResult extends ActionResult {
  sequenceId?: string;
}

export async function createSequence(input: SequenceInput): Promise<CreateSequenceResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = sequenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the sequence details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const sequence = await prisma.sequence.create({
    data: {
      organizationId: membership.organizationId,
      campaignId: parsed.data.campaignId || null,
      name: parsed.data.name,
      steps: parsed.data.steps as unknown as Prisma.InputJsonValue,
    },
  });

  await logAudit({ userId, organizationId: membership.organizationId, action: "outreach.sequence_created", metadata: { sequenceId: sequence.id } });
  revalidatePath("/dashboard/outreach");
  return { ok: true, sequenceId: sequence.id };
}

export async function updateSequence(sequenceId: string, input: SequenceInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = sequenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the sequence details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const existing = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!existing || existing.organizationId !== membership.organizationId) return { ok: false, error: "Sequence not found." };

  await prisma.sequence.update({
    where: { id: sequenceId },
    data: { name: parsed.data.name, campaignId: parsed.data.campaignId || null, steps: parsed.data.steps as unknown as Prisma.InputJsonValue },
  });

  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

export async function deleteSequence(sequenceId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const existing = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!existing || existing.organizationId !== membership.organizationId) return { ok: false, error: "Sequence not found." };

  await prisma.sequence.delete({ where: { id: sequenceId } });
  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

function resolveStepChannelAndPurpose(step: SequenceStepInput): { channel: DraftChannel; purpose: DraftPurpose } {
  if (step.type === "LINKEDIN") return { channel: "LINKEDIN", purpose: step.purpose ?? "CONNECTION_REQUEST" };
  if (step.type === "REMINDER") return { channel: "EMAIL", purpose: step.purpose ?? "REMINDER" };
  if (step.type === "MEETING_REQUEST") return { channel: "EMAIL", purpose: step.purpose ?? "MEETING_REQUEST" };
  return { channel: "EMAIL", purpose: step.purpose ?? "INTRODUCTION" };
}

function nextContentStepIndex(steps: SequenceStepInput[], afterIndex: number): number | null {
  for (let i = afterIndex + 1; i < steps.length; i++) {
    if (steps[i].type !== "WAIT") return i;
  }
  return null;
}

export interface EnrollContactResult extends ActionResult {
  draft?: EmailDraft;
}

/** Enrolls a contact in a sequence — generates the first real content step's draft immediately. */
export async function enrollContact(sequenceId: string, contactId: string, campaignId?: string): Promise<EnrollContactResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const sequence = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!sequence || sequence.organizationId !== membership.organizationId) return { ok: false, error: "Sequence not found." };

  const steps = sequence.steps as unknown as SequenceStepInput[];
  const firstContentIndex = nextContentStepIndex(steps, -1);
  if (firstContentIndex === null) return { ok: false, error: "This sequence has no content steps yet." };

  const { channel, purpose } = resolveStepChannelAndPurpose(steps[firstContentIndex]);
  const tone: EmailTone = steps[firstContentIndex].tone ?? "PROFESSIONAL";

  try {
    const draft = await generateEmailDraft({
      contactId,
      purpose,
      tone,
      channel,
      campaignId: campaignId ?? sequence.campaignId ?? undefined,
      sequenceId,
      sequenceStepIndex: firstContentIndex,
    });
    revalidatePath("/dashboard/outreach");
    return { ok: true, draft };
  } catch (error) {
    return describeAIError(error);
  }
}

export interface AdvanceSequenceResult extends ActionResult {
  advanced: boolean;
  complete?: boolean;
  draft?: EmailDraft;
}

/**
 * Headless core of advanceSequence — no session, callable from the
 * Scheduler Service's sequenceAdvancementJob (src/lib/scheduler/registry.ts)
 * as well as from the session-gated Server Action below. Mirrors
 * startSystemTriggeredExecutiveMeeting's split (src/lib/ai/meeting-lifecycle.ts):
 * everything past the auth/membership check lives here. Only advances once
 * the prior step was genuinely SENT and its configured delayDays have really
 * elapsed — this is an idempotent "is it due yet" check, safe to call
 * repeatedly (on page view or on a cron tick) with no duplicate side effects.
 *
 * Phase 6: a contact who has told us NOT_INTERESTED or UNSUBSCRIBED must
 * never receive another generated step — checked first, before even loading
 * the sequence, as an honest no-op (not an error) so a normal "nothing due
 * yet" caller can't tell the difference from a suppressed one.
 */
export async function advanceSequenceCore(contactId: string, sequenceId: string, organizationId: string): Promise<AdvanceSequenceResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (contact && (contact.status === "NOT_INTERESTED" || contact.status === "UNSUBSCRIBED")) {
    return { ok: true, advanced: false };
  }

  const sequence = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!sequence || sequence.organizationId !== organizationId) return { ok: false, error: "Sequence not found.", advanced: false };

  const latestDraft = await prisma.emailDraft.findFirst({
    where: { contactId, sequenceId },
    orderBy: { sequenceStepIndex: "desc" },
  });
  if (!latestDraft) return { ok: true, advanced: false };
  if (latestDraft.status !== "SENT" || !latestDraft.sentAt) return { ok: true, advanced: false };

  const steps = sequence.steps as unknown as SequenceStepInput[];
  const nextIndex = nextContentStepIndex(steps, latestDraft.sequenceStepIndex ?? -1);
  if (nextIndex === null) return { ok: true, advanced: false, complete: true };

  const daysSinceSent = (Date.now() - latestDraft.sentAt.getTime()) / 86_400_000;
  const requiredDelay = steps[nextIndex].delayDays ?? 0;
  if (daysSinceSent < requiredDelay) return { ok: true, advanced: false };

  const { channel, purpose } = resolveStepChannelAndPurpose(steps[nextIndex]);
  const tone: EmailTone = steps[nextIndex].tone ?? "PROFESSIONAL";

  try {
    const draft = await generateEmailDraft({
      contactId,
      purpose,
      tone,
      channel,
      campaignId: latestDraft.campaignId ?? undefined,
      sequenceId,
      sequenceStepIndex: nextIndex,
    });
    revalidatePath("/dashboard/outreach");
    return { ok: true, advanced: true, draft };
  } catch (error) {
    return { ...describeAIError(error), advanced: false };
  }
}

/**
 * Session-gated Server Action wrapper — checked on page load / a manual
 * "check for due follow-ups" action, same convention as
 * checkSavedSearchForMatches. The Scheduler Service's sequenceAdvancementJob
 * calls advanceSequenceCore directly so this same idempotent check also runs
 * on a regular cron tick, not only when a user happens to visit the page.
 */
export async function advanceSequence(contactId: string, sequenceId: string): Promise<AdvanceSequenceResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in.", advanced: false };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet.", advanced: false };

  return advanceSequenceCore(contactId, sequenceId, membership.organizationId);
}
