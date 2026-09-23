"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkPlanLimit, recordUsage } from "@/lib/billing/usage-metering";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { automationRuleSchema, type AutomationRuleInput } from "@/lib/validations/automation";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  createWorkflowStepSchema,
  updateWorkflowStepSchema,
  connectWorkflowStepsSchema,
  workflowNodeTypeSchema,
  workflowTriggerTypeSchema,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type CreateWorkflowStepInput,
  type UpdateWorkflowStepInput,
} from "@/lib/validations/workflows";
import { NODE_CONFIG_SCHEMAS } from "@/lib/validations/workflow-node-configs";
import * as workflowCrud from "@/lib/workflows/crud";
import { cancelWorkflowRun, startWorkflowRun } from "@/lib/workflows/engine";
import { generateWorkflowPlan, WorkflowPlanValidationError, type WorkflowPlan } from "@/lib/workflows/ai-designer";
import { createWorkflowFromPlan } from "@/lib/workflows/ai-designer-persist";
import { enqueueWebhookDelivery } from "@/lib/workflows/webhook-delivery-queue";
import * as webhookLib from "@/lib/workflows/webhooks";
import { z } from "zod";
import { createWebhookSchema, webhookEventTypeSchema, type CreateWebhookInput } from "@/lib/validations/webhooks";
import type { Webhook } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
}

const EDITOR_ROLES = new Set(["OWNER", "ADMIN"]);

async function requireEditableMembership(userId: string) {
  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  if (!EDITOR_ROLES.has(membership.role)) {
    return { ok: false as const, error: "Only owners and admins can manage automation rules." };
  }
  return { ok: true as const, membership };
}

export interface CreateRuleResult extends ActionResult {
  ruleId?: string;
}

export async function createAutomationRule(input: AutomationRuleInput): Promise<CreateRuleResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = automationRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the rule." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;
  const organizationId = access.membership.organizationId;

  try {
    const rule = await prisma.automationRule.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        trigger: parsed.data.trigger,
        action: parsed.data.action,
        actionConfig: parsed.data.actionConfig,
      },
    });

    await logAudit({ userId, organizationId, action: "automation.rule_created", metadata: { ruleId: rule.id } });
    revalidatePath("/dashboard/automation");
    return { ok: true, ruleId: rule.id };
  } catch (error) {
    console.error("[automation] createAutomationRule failed:", error);
    return { ok: false, error: "Something went wrong creating the rule. Please try again." };
  }
}

export async function toggleAutomationRule(ruleId: string, active: boolean): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  try {
    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.organizationId !== access.membership.organizationId) {
      return { ok: false, error: "Rule not found." };
    }
    await prisma.automationRule.update({ where: { id: ruleId }, data: { active } });
    revalidatePath("/dashboard/automation");
    return { ok: true };
  } catch (error) {
    console.error("[automation] toggleAutomationRule failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function deleteAutomationRule(ruleId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  try {
    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.organizationId !== access.membership.organizationId) {
      return { ok: false, error: "Rule not found." };
    }
    await prisma.automationRule.delete({ where: { id: ruleId } });
    revalidatePath("/dashboard/automation");
    return { ok: true };
  } catch (error) {
    console.error("[automation] deleteAutomationRule failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Workflow (multi-step, branchable) automation — thin "use server" wrappers
// over src/lib/workflows/crud.ts. Reads (list/detail) any active member can
// do; every mutation requires OWNER/ADMIN, same as the AutomationRule
// actions above.
// ---------------------------------------------------------------------------

const WORKFLOW_LIST_PATH = "/dashboard/automation";

function workflowDetailPath(workflowId: string): string {
  return `/dashboard/automation/workflows/${workflowId}`;
}

async function requireOrgWorkflow(organizationId: string, workflowId: string) {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow || workflow.organizationId !== organizationId) return null;
  return workflow;
}

async function requireOrgWorkflowStep(organizationId: string, stepId: string) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { workflow: true } });
  if (!step || step.workflow.organizationId !== organizationId) return null;
  return step;
}

export interface CreateWorkflowResult extends ActionResult {
  workflowId?: string;
}

export async function createWorkflowAction(input: CreateWorkflowInput): Promise<CreateWorkflowResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = createWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the workflow details." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  try {
    const workflow = await workflowCrud.createWorkflow(access.membership.organizationId, userId, parsed.data);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_created", metadata: { workflowId: workflow.id } });
    revalidatePath(WORKFLOW_LIST_PATH);
    return { ok: true, workflowId: workflow.id };
  } catch (error) {
    console.error("[automation] createWorkflowAction failed:", error);
    return { ok: false, error: "Something went wrong creating the workflow. Please try again." };
  }
}

export async function updateWorkflowAction(workflowId: string, input: UpdateWorkflowInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = updateWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the workflow details." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const workflow = await requireOrgWorkflow(access.membership.organizationId, workflowId);
  if (!workflow) return { ok: false, error: "Workflow not found." };

  try {
    await workflowCrud.updateWorkflow(workflowId, parsed.data);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_updated", metadata: { workflowId } });
    revalidatePath(WORKFLOW_LIST_PATH);
    revalidatePath(workflowDetailPath(workflowId));
    return { ok: true };
  } catch (error) {
    console.error("[automation] updateWorkflowAction failed:", error);
    return { ok: false, error: "Something went wrong updating the workflow. Please try again." };
  }
}

export async function setWorkflowStatusAction(workflowId: string, status: UpdateWorkflowInput["status"]): Promise<ActionResult> {
  return updateWorkflowAction(workflowId, { status });
}

export async function deleteWorkflowAction(workflowId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const workflow = await requireOrgWorkflow(access.membership.organizationId, workflowId);
  if (!workflow) return { ok: false, error: "Workflow not found." };

  try {
    await workflowCrud.deleteWorkflow(workflowId);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_deleted", metadata: { workflowId } });
    revalidatePath(WORKFLOW_LIST_PATH);
    return { ok: true };
  } catch (error) {
    console.error("[automation] deleteWorkflowAction failed:", error);
    return { ok: false, error: "Something went wrong deleting the workflow. Please try again." };
  }
}

export async function duplicateWorkflowAction(workflowId: string): Promise<CreateWorkflowResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const workflow = await requireOrgWorkflow(access.membership.organizationId, workflowId);
  if (!workflow) return { ok: false, error: "Workflow not found." };

  try {
    const copy = await workflowCrud.duplicateWorkflow(workflowId, access.membership.organizationId, userId);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_duplicated", metadata: { workflowId, copyId: copy.id } });
    revalidatePath(WORKFLOW_LIST_PATH);
    return { ok: true, workflowId: copy.id };
  } catch (error) {
    console.error("[automation] duplicateWorkflowAction failed:", error);
    return { ok: false, error: "Something went wrong duplicating the workflow. Please try again." };
  }
}

export interface AddWorkflowStepResult extends ActionResult {
  stepId?: string;
}

export async function addWorkflowStepAction(input: CreateWorkflowStepInput): Promise<AddWorkflowStepResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = createWorkflowStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the step details." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const workflow = await requireOrgWorkflow(access.membership.organizationId, parsed.data.workflowId);
  if (!workflow) return { ok: false, error: "Workflow not found." };

  try {
    const step = await workflowCrud.addWorkflowStep(parsed.data.workflowId, parsed.data);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_step_added", metadata: { workflowId: workflow.id, stepId: step.id } });
    revalidatePath(workflowDetailPath(workflow.id));
    return { ok: true, stepId: step.id };
  } catch (error) {
    console.error("[automation] addWorkflowStepAction failed:", error);
    return { ok: false, error: "Something went wrong adding the step. Please try again." };
  }
}

export async function updateWorkflowStepAction(stepId: string, input: UpdateWorkflowStepInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = updateWorkflowStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the step details." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const step = await requireOrgWorkflowStep(access.membership.organizationId, stepId);
  if (!step) return { ok: false, error: "Step not found." };

  try {
    await workflowCrud.updateWorkflowStep(stepId, parsed.data);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_step_updated", metadata: { workflowId: step.workflowId, stepId } });
    revalidatePath(workflowDetailPath(step.workflowId));
    return { ok: true };
  } catch (error) {
    console.error("[automation] updateWorkflowStepAction failed:", error);
    return { ok: false, error: "Something went wrong updating the step. Please try again." };
  }
}

export async function deleteWorkflowStepAction(stepId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const step = await requireOrgWorkflowStep(access.membership.organizationId, stepId);
  if (!step) return { ok: false, error: "Step not found." };

  try {
    await workflowCrud.deleteWorkflowStep(stepId);
    await logAudit({ userId, organizationId: access.membership.organizationId, action: "automation.workflow_step_deleted", metadata: { workflowId: step.workflowId, stepId } });
    revalidatePath(workflowDetailPath(step.workflowId));
    return { ok: true };
  } catch (error) {
    console.error("[automation] deleteWorkflowStepAction failed:", error);
    return { ok: false, error: "Something went wrong deleting the step. Please try again." };
  }
}

export async function connectWorkflowStepsAction(fromStepId: string, toStepId: string, branch?: "true" | "false"): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = connectWorkflowStepsSchema.safeParse({ fromStepId, toStepId, branch });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the connection." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const fromStep = await requireOrgWorkflowStep(access.membership.organizationId, parsed.data.fromStepId);
  if (!fromStep) return { ok: false, error: "Step not found." };
  const toStep = await requireOrgWorkflowStep(access.membership.organizationId, parsed.data.toStepId);
  if (!toStep || toStep.workflowId !== fromStep.workflowId) {
    return { ok: false, error: "Both steps must belong to the same workflow." };
  }

  try {
    await workflowCrud.connectWorkflowSteps(parsed.data.fromStepId, parsed.data.toStepId, parsed.data.branch);
    revalidatePath(workflowDetailPath(fromStep.workflowId));
    return { ok: true };
  } catch (error) {
    console.error("[automation] connectWorkflowStepsAction failed:", error);
    return { ok: false, error: "Something went wrong connecting the steps. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Workflow run history / execution trace — read-only for any active member
// (enforced by requireActiveMembership in the pages themselves); cancelling a
// real in-flight run is a mutation and requires the same OWNER/ADMIN check as
// every other workflow mutation above.
// ---------------------------------------------------------------------------

function workflowRunsPath(workflowId: string): string {
  return `${workflowDetailPath(workflowId)}/runs`;
}

function workflowRunDetailPath(workflowId: string, runId: string): string {
  return `${workflowRunsPath(workflowId)}/${runId}`;
}

export async function cancelWorkflowRunAction(runId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run || run.organizationId !== access.membership.organizationId) {
    return { ok: false, error: "Run not found." };
  }
  if (run.status !== "RUNNING" && run.status !== "QUEUED") {
    return { ok: false, error: "Only running or queued runs can be cancelled." };
  }

  try {
    await cancelWorkflowRun(runId);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.workflow_run_cancelled",
      metadata: { workflowId: run.workflowId, runId },
    });
    revalidatePath(workflowRunsPath(run.workflowId));
    revalidatePath(workflowRunDetailPath(run.workflowId, runId));
    return { ok: true };
  } catch (error) {
    console.error("[automation] cancelWorkflowRunAction failed:", error);
    return { ok: false, error: "Something went wrong cancelling the run. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// "Run now" — a real manual trigger for the execution engine
// (src/lib/workflows/engine.ts's startWorkflowRun). Offered for every
// workflow regardless of its configured triggerType, not just ones whose
// triggerType is the explicit "MANUAL" enum value — a "test this workflow
// manually" affordance is genuinely useful for a LEAD_CREATED- or
// CRON-triggered workflow too, and the resulting WorkflowRun's real
// triggerPayload records `{ triggeredBy: "manual" }` regardless, so nothing
// about the run is misrepresented as having come from its configured
// trigger. Requires OWNER/ADMIN, same as every other workflow mutation
// above — starting a run has real side effects (CRM writes, emails, etc.).
// ---------------------------------------------------------------------------

export interface StartWorkflowRunResult extends ActionResult {
  runId?: string;
}

export async function startWorkflowRunAction(workflowId: string): Promise<StartWorkflowRunResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const workflow = await requireOrgWorkflow(access.membership.organizationId, workflowId);
  if (!workflow) return { ok: false, error: "Workflow not found." };

  const steps = await prisma.workflowStep.findMany({ where: { workflowId } });
  if (!steps.some((s) => s.nodeType === "TRIGGER")) {
    return { ok: false, error: "This workflow has no Trigger node yet — add one before running it." };
  }

  // Real plan-limit enforcement — this org's current Plan.automationRunsMonthly
  // gates whether it can start any more workflow runs this billing period.
  const runLimit = await checkPlanLimit(access.membership.organizationId, "AUTOMATION_RUNS");
  if (!runLimit.allowed) {
    return { ok: false, error: runLimit.reason ?? "This organization has reached its plan's automation-run limit for this period." };
  }

  try {
    const runId = await startWorkflowRun(workflowId, access.membership.organizationId, {
      triggeredBy: "manual",
      triggeredByUserId: userId,
      triggeredAt: new Date().toISOString(),
    });
    await recordUsage(access.membership.organizationId, "AUTOMATION_RUNS", 1, { workflowId, runId, triggeredBy: "manual" });
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.workflow_run_started",
      metadata: { workflowId, runId },
    });
    revalidatePath(workflowDetailPath(workflowId));
    revalidatePath(workflowRunsPath(workflowId));
    return { ok: true, runId };
  } catch (error) {
    console.error("[automation] startWorkflowRunAction failed:", error);
    return { ok: false, error: "Something went wrong starting the run. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// AI Workflow Designer — src/lib/workflows/ai-designer.ts's real Claude
// tool-use call turns a plain-English request into a structured WorkflowPlan
// (generateWorkflowPlanAction, preview-only, any active member — same "any
// active member can generate a preview" gate as generateProposal in
// src/app/dashboard/proposal/actions.ts), and
// src/lib/workflows/ai-designer-persist.ts's createWorkflowFromPlan turns an
// approved plan into a real Workflow + WorkflowStep graph
// (createWorkflowFromPlanAction, a genuine mutation, so it requires the same
// OWNER/ADMIN gate as every other workflow-mutating action above). The error
// translation for AINotConnectedError/AIBillingError below matches the exact
// wording every other AI-generation Server Action in this codebase uses
// (see describeAIError in src/app/dashboard/proposal/actions.ts).
// ---------------------------------------------------------------------------

function describeAIWorkflowError(error: unknown): ActionResult {
  if (error instanceof AINotConnectedError) {
    return {
      ok: false,
      errorKind: "not_connected",
      error: "AI is not connected — no ANTHROPIC_API_KEY is configured for this environment.",
    };
  }
  if (error instanceof AIBillingError || isAIBillingError(error)) {
    return {
      ok: false,
      errorKind: "billing",
      error: "AI is connected but the account has no API credits — add credits at console.anthropic.com/settings/billing.",
    };
  }
  if (error instanceof WorkflowPlanValidationError) {
    console.error("[automation] AI workflow plan failed validation:", error.issues);
    return {
      ok: false,
      errorKind: "generic",
      error: "The AI couldn't produce a valid workflow plan for that request. Try rephrasing it with more detail.",
    };
  }
  console.error("[automation] AI workflow generation failed:", error);
  return { ok: false, errorKind: "generic", error: "Something went wrong generating the workflow plan. Please try again." };
}

export interface GenerateWorkflowPlanResult extends ActionResult {
  plan?: WorkflowPlan;
}

/** Real Claude-generated workflow plan preview — never persisted by this action; the user reviews it and calls createWorkflowFromPlanAction to actually create the workflow. */
export async function generateWorkflowPlanAction(prompt: string): Promise<GenerateWorkflowPlanResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length < 3) {
    return { ok: false, error: "Describe the workflow you want to build in a bit more detail." };
  }
  if (trimmedPrompt.length > 2000) {
    return { ok: false, error: "That description is too long — keep it under 2000 characters." };
  }

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  if (!checkRateLimit(`workflow-ai-designer:${userId}`, { limit: 15, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, errorKind: "generic", error: "Too many workflow generations requested — wait a few minutes and try again." };
  }

  try {
    const plan = await generateWorkflowPlan(trimmedPrompt);
    return { ok: true, plan };
  } catch (error) {
    return describeAIWorkflowError(error);
  }
}

/**
 * Persists an AI-generated (and possibly client-edited) WorkflowPlan as a
 * real Workflow + WorkflowStep graph. The plan round-trips through the
 * client between generateWorkflowPlanAction and this action, so every
 * step's config is re-validated here against NODE_CONFIG_SCHEMAS[nodeType]
 * — the same last-line-of-defense re-validation updateWorkflowStepAction's
 * callers apply before ever saving client-supplied config — rather than
 * trusting the JSON the client resubmits.
 */
export async function createWorkflowFromPlanAction(plan: WorkflowPlan): Promise<CreateWorkflowResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, error: "This workflow plan has no steps to create." };
  }
  if (!plan.name?.trim()) {
    return { ok: false, error: "This workflow plan is missing a name." };
  }
  const parsedTrigger = workflowTriggerTypeSchema.safeParse(plan.triggerType);
  if (!parsedTrigger.success) {
    return { ok: false, error: "This workflow plan has an invalid trigger type." };
  }
  if (plan.steps[0]?.nodeType !== "TRIGGER") {
    return { ok: false, error: "A workflow plan's first step must be a Trigger node." };
  }

  const validatedSteps: WorkflowPlan["steps"] = [];
  for (const step of plan.steps) {
    const parsedNodeType = workflowNodeTypeSchema.safeParse(step.nodeType);
    if (!parsedNodeType.success) {
      return { ok: false, error: `Step "${step.name}" has an unknown node type.` };
    }
    const configSchema = NODE_CONFIG_SCHEMAS[parsedNodeType.data];
    const parsedConfig = configSchema.safeParse(step.config ?? {});
    if (!parsedConfig.success) {
      return { ok: false, error: `Step "${step.name}": ${parsedConfig.error.issues[0]?.message ?? "invalid configuration."}` };
    }
    validatedSteps.push({ ...step, nodeType: parsedNodeType.data, config: parsedConfig.data as Record<string, unknown> });
  }

  const validatedPlan: WorkflowPlan = { ...plan, triggerType: parsedTrigger.data, steps: validatedSteps };

  try {
    const { workflowId } = await createWorkflowFromPlan(access.membership.organizationId, userId, validatedPlan);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.workflow_ai_generated",
      metadata: { workflowId, name: validatedPlan.name },
    });
    revalidatePath(WORKFLOW_LIST_PATH);
    return { ok: true, workflowId };
  } catch (error) {
    console.error("[automation] createWorkflowFromPlanAction failed:", error);
    return { ok: false, error: "Something went wrong creating the workflow from the plan. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Webhook management — per-workflow incoming/outgoing webhooks, thin wrappers
// over src/lib/workflows/webhooks.ts. Every action here, including the list
// read, requires OWNER/ADMIN — unlike the workflow step/run reads elsewhere
// in this file, these create, rotate, and reveal real HMAC signing secrets
// (once, in plaintext) and a real receivable URL, so the webhook list itself
// is treated as a privileged view rather than a general "any active member
// can read" surface; the page only mounts the management UI for canManage
// users in the first place. An org-scoped lookup helper mirrors
// requireOrgWorkflow/requireOrgWorkflowStep above rather than relying solely
// on the org check inside webhookLib's mutators, so this file can resolve
// (and revalidate) the owning workflow's path before calling into the lib.
// ---------------------------------------------------------------------------

async function requireOrgWebhook(organizationId: string, webhookId: string) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || webhook.organizationId !== organizationId) return null;
  return webhook;
}

function revalidateWebhookOwner(workflowId: string | null): void {
  if (workflowId) revalidatePath(workflowDetailPath(workflowId));
  else revalidatePath(WORKFLOW_LIST_PATH);
}

export interface WebhookActionResult extends ActionResult {
  webhook?: Webhook;
  plaintextSecret?: string;
}

/**
 * Creates an INCOMING or OUTGOING webhook and returns its real plaintext
 * signing secret exactly once — the caller (webhook-manager.tsx) is
 * responsible for displaying it a single time via the same reveal-once
 * pattern as createApiKey in src/app/profile/actions.ts; it can never be
 * fetched again after this call returns, only rotated.
 */
export async function createWebhookAction(input: CreateWebhookInput): Promise<WebhookActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the webhook details." };
  }

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  if (parsed.data.workflowId) {
    const workflow = await requireOrgWorkflow(access.membership.organizationId, parsed.data.workflowId);
    if (!workflow) return { ok: false, error: "Workflow not found." };
  }

  try {
    const { webhook, plaintextSecret } = await webhookLib.createWebhook(access.membership.organizationId, parsed.data);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.webhook_created",
      metadata: { webhookId: webhook.id, direction: webhook.direction, workflowId: webhook.workflowId },
    });
    revalidateWebhookOwner(webhook.workflowId);
    return { ok: true, webhook, plaintextSecret };
  } catch (error) {
    console.error("[automation] createWebhookAction failed:", error);
    return { ok: false, error: "Something went wrong creating the webhook. Please try again." };
  }
}

export interface ListWebhooksResult extends ActionResult {
  webhooks?: Webhook[];
}

export async function listWebhooksAction(workflowId?: string): Promise<ListWebhooksResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  if (workflowId) {
    const workflow = await requireOrgWorkflow(access.membership.organizationId, workflowId);
    if (!workflow) return { ok: false, error: "Workflow not found." };
  }

  try {
    const webhooks = await webhookLib.listWebhooks(access.membership.organizationId, workflowId);
    return { ok: true, webhooks };
  } catch (error) {
    console.error("[automation] listWebhooksAction failed:", error);
    return { ok: false, error: "Something went wrong loading webhooks. Please try again." };
  }
}

/** Generates and persists a brand-new secret, invalidating the old one, and returns the new plaintext once — same reveal-once handling as createWebhookAction. */
export async function rotateWebhookSecretAction(webhookId: string): Promise<WebhookActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const webhook = await requireOrgWebhook(access.membership.organizationId, webhookId);
  if (!webhook) return { ok: false, error: "Webhook not found." };

  try {
    const { plaintextSecret } = await webhookLib.rotateWebhookSecret(webhookId, access.membership.organizationId);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.webhook_secret_rotated",
      metadata: { webhookId, workflowId: webhook.workflowId },
    });
    revalidateWebhookOwner(webhook.workflowId);
    return { ok: true, plaintextSecret };
  } catch (error) {
    console.error("[automation] rotateWebhookSecretAction failed:", error);
    return { ok: false, error: "Something went wrong rotating the secret. Please try again." };
  }
}

export async function toggleWebhookActiveAction(webhookId: string, active: boolean): Promise<WebhookActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const existing = await requireOrgWebhook(access.membership.organizationId, webhookId);
  if (!existing) return { ok: false, error: "Webhook not found." };

  try {
    const webhook = await webhookLib.toggleWebhookActive(webhookId, access.membership.organizationId, active);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: active ? "automation.webhook_activated" : "automation.webhook_deactivated",
      metadata: { webhookId, workflowId: webhook.workflowId },
    });
    revalidateWebhookOwner(webhook.workflowId);
    return { ok: true, webhook };
  } catch (error) {
    console.error("[automation] toggleWebhookActiveAction failed:", error);
    return { ok: false, error: "Something went wrong updating the webhook. Please try again." };
  }
}

/** Phase 33: replaces the full set of platform event-bus subscriptions (WebhookEventType[]) this webhook receives. Independent of, and safe to call regardless of, the webhook's workflowId/direction. */
export async function updateWebhookEventTypesAction(webhookId: string, eventTypes: string[]): Promise<WebhookActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = z.array(webhookEventTypeSchema).safeParse(eventTypes);
  if (!parsed.success) return { ok: false, error: "Invalid event type." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const existing = await requireOrgWebhook(access.membership.organizationId, webhookId);
  if (!existing) return { ok: false, error: "Webhook not found." };

  try {
    const webhook = await webhookLib.updateWebhookEventTypes(webhookId, access.membership.organizationId, parsed.data);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.webhook_event_types_updated",
      metadata: { webhookId, eventTypes: parsed.data },
    });
    revalidateWebhookOwner(webhook.workflowId);
    return { ok: true, webhook };
  } catch (error) {
    console.error("[automation] updateWebhookEventTypesAction failed:", error);
    return { ok: false, error: "Something went wrong updating event subscriptions. Please try again." };
  }
}

export async function deleteWebhookAction(webhookId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const webhook = await requireOrgWebhook(access.membership.organizationId, webhookId);
  if (!webhook) return { ok: false, error: "Webhook not found." };

  try {
    await webhookLib.deleteWebhook(webhookId, access.membership.organizationId);
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.webhook_deleted",
      metadata: { webhookId, workflowId: webhook.workflowId },
    });
    revalidateWebhookOwner(webhook.workflowId);
    return { ok: true };
  } catch (error) {
    console.error("[automation] deleteWebhookAction failed:", error);
    return { ok: false, error: "Something went wrong deleting the webhook. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Webhook delivery logs — the read side (listWebhookDeliveries in
// src/lib/workflows/webhooks.ts) is fetched directly by the delivery-log
// Server Component; the only mutation here is a manual retry of a failed
// OUTGOING delivery, which re-enqueues the delivery's real stored payload
// against the webhook's real targetUrl through the dedicated BullMQ queue in
// src/lib/workflows/webhook-delivery-queue.ts rather than replaying it
// in-process. Requires OWNER/ADMIN, same as every other workflow mutation
// above — retrying a delivery has a real side effect (an outbound HTTP call).
// ---------------------------------------------------------------------------

export async function retryWebhookDeliveryAction(deliveryId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const access = await requireEditableMembership(userId);
  if (!access.ok) return access;

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery || delivery.webhook.organizationId !== access.membership.organizationId) {
    return { ok: false, error: "Delivery not found." };
  }
  if (delivery.direction !== "OUTGOING") {
    return { ok: false, error: "Only outgoing webhook deliveries can be retried — this one was incoming." };
  }
  if (!delivery.webhook.targetUrl) {
    return { ok: false, error: "This webhook has no target URL configured — there's nothing to retry." };
  }

  try {
    await enqueueWebhookDelivery({
      webhookId: delivery.webhookId,
      url: delivery.webhook.targetUrl,
      method: "POST",
      body: delivery.payload,
    });
    await logAudit({
      userId,
      organizationId: access.membership.organizationId,
      action: "automation.webhook_delivery_retried",
      metadata: { webhookId: delivery.webhookId, deliveryId },
    });
    revalidateWebhookOwner(delivery.webhook.workflowId);
    return { ok: true };
  } catch (error) {
    console.error("[automation] retryWebhookDeliveryAction failed:", error);
    return { ok: false, error: "Something went wrong retrying the delivery. Please try again." };
  }
}
