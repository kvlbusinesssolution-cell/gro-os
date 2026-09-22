"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime/event-bus";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const REVALIDATE_PATH = "/dashboard/priority-queue";

async function requireSession(): Promise<{ userId: string; organizationId: string } | { error: ActionResult }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: { ok: false, error: "You must be signed in." } };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { error: { ok: false, error: "You don't belong to an organization yet." } };

  return { userId, organizationId: membership.organizationId };
}

async function loadOpportunityInOrg(organizationId: string, opportunityId: string) {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: { select: { organizationId: true, name: true } } },
  });
  if (!opportunity || opportunity.company.organizationId !== organizationId) return null;
  return opportunity;
}

/**
 * Assign / unassign — backs both the per-row "Assign to me" quick action and
 * the bulk-select "Assign to me" bar action. Assigning to someone else (via
 * the row's "Assign to..." picker) sends a real TASK_ASSIGNED notification;
 * self-assignment doesn't (you already know).
 */
export async function assignOpportunity(opportunityId: string, assigneeUserId: string | null): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;

  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  if (assigneeUserId) {
    const membership = await prisma.membership.findFirst({ where: { userId: assigneeUserId, organizationId, status: "ACTIVE" } });
    if (!membership) return { ok: false, error: "That person isn't an active member of this organization." };
  }

  await prisma.leadOpportunity.update({ where: { id: opportunityId }, data: { ownerUserId: assigneeUserId } });

  await logAudit({
    userId,
    organizationId,
    action: assigneeUserId ? "priority_queue.assigned" : "priority_queue.unassigned",
    metadata: { opportunityId, assigneeUserId },
  });

  if (assigneeUserId && assigneeUserId !== userId) {
    await notifyUser({
      userId: assigneeUserId,
      organizationId,
      type: "TASK_ASSIGNED",
      title: "An opportunity was assigned to you",
      message: `${opportunity.title} at ${opportunity.company.name} is now yours to work.`,
    });
  }

  publishRealtimeEvent({ kind: "activity", organizationId });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

export async function assignOpportunityToMe(opportunityId: string): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  return assignOpportunity(opportunityId, auth_.userId);
}

export async function bulkAssignToMe(opportunityIds: string[]): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;

  await prisma.leadOpportunity.updateMany({
    where: { id: { in: opportunityIds }, company: { organizationId } },
    data: { ownerUserId: userId },
  });

  await logAudit({ userId, organizationId, action: "priority_queue.bulk_assigned", metadata: { opportunityIds, assigneeUserId: userId } });
  publishRealtimeEvent({ kind: "activity", organizationId });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

/**
 * Snooze — parks an opportunity out of the default queue view until a given
 * date without touching its status/priority/score. `snoozeOpportunity`
 * takes a number of days from now (what the UI actually offers: 1/3/7/30
 * days) rather than a raw Date, so the server is the source of truth for
 * "now" and a stale client clock can't misfire it.
 */
export async function snoozeOpportunity(opportunityId: string, days: number): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;

  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };
  if (!Number.isFinite(days) || days <= 0) return { ok: false, error: "Invalid snooze duration." };

  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.leadOpportunity.update({ where: { id: opportunityId }, data: { snoozedUntil } });

  await logAudit({ userId, organizationId, action: "priority_queue.snoozed", metadata: { opportunityId, snoozedUntil: snoozedUntil.toISOString() } });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

export async function unsnoozeOpportunity(opportunityId: string): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;

  const opportunity = await loadOpportunityInOrg(organizationId, opportunityId);
  if (!opportunity) return { ok: false, error: "Opportunity not found." };

  await prisma.leadOpportunity.update({ where: { id: opportunityId }, data: { snoozedUntil: null } });
  await logAudit({ userId, organizationId, action: "priority_queue.unsnoozed", metadata: { opportunityId } });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

export async function bulkSnooze(opportunityIds: string[], days: number): Promise<ActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;
  if (!Number.isFinite(days) || days <= 0) return { ok: false, error: "Invalid snooze duration." };

  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await prisma.leadOpportunity.updateMany({
    where: { id: { in: opportunityIds }, company: { organizationId } },
    data: { snoozedUntil },
  });

  await logAudit({ userId, organizationId, action: "priority_queue.bulk_snoozed", metadata: { opportunityIds, snoozedUntil: snoozedUntil.toISOString() } });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

/**
 * Bulk triage — thin loops over the existing single-opportunity core
 * actions (opportunities/_lib/opportunity-actions.ts), so bulk and
 * single-row triage can never drift into different business rules (e.g. the
 * "already added to CRM" terminal-state guard). Best-effort: one failing row
 * (already terminal, deal-stage missing, etc.) doesn't abort the rest — the
 * result reports how many actually succeeded.
 */
export interface BulkActionResult extends ActionResult {
  succeeded: number;
  failed: number;
}

async function runBulk(
  opportunityIds: string[],
  organizationId: string,
  userId: string,
  run: (organizationId: string, userId: string, opportunityId: string) => Promise<ActionResult>,
): Promise<BulkActionResult> {
  let succeeded = 0;
  let failed = 0;
  for (const id of opportunityIds) {
    const result = await run(organizationId, userId, id);
    if (result.ok) succeeded++;
    else failed++;
  }
  revalidatePath(REVALIDATE_PATH);
  revalidatePath("/dashboard/opportunities");
  return { ok: failed === 0, succeeded, failed };
}

export async function bulkAddToCrm(opportunityIds: string[]): Promise<BulkActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return { ...auth_.error, succeeded: 0, failed: opportunityIds.length };
  const { addOpportunityToCrmCore } = await import("../opportunities/_lib/opportunity-actions");
  return runBulk(opportunityIds, auth_.organizationId, auth_.userId, addOpportunityToCrmCore);
}

export async function bulkDismiss(opportunityIds: string[]): Promise<BulkActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return { ...auth_.error, succeeded: 0, failed: opportunityIds.length };
  const { dismissOpportunityCore } = await import("../opportunities/_lib/opportunity-actions");
  return runBulk(opportunityIds, auth_.organizationId, auth_.userId, dismissOpportunityCore);
}

export async function bulkMarkReviewed(opportunityIds: string[]): Promise<BulkActionResult> {
  const auth_ = await requireSession();
  if ("error" in auth_) return { ...auth_.error, succeeded: 0, failed: opportunityIds.length };
  const { markOpportunityForReviewCore } = await import("../opportunities/_lib/opportunity-actions");
  return runBulk(opportunityIds, auth_.organizationId, auth_.userId, markOpportunityForReviewCore);
}

// ----- Saved views -----
// Reuses the existing SavedSearch table (see dashboard/_lib/saved-search-actions.ts
// for its Lead/Client Finder use) as generic per-user named-filter storage —
// `filters` is untyped Json in the schema, so a `kind: "priority_queue"`
// discriminator with this page's own querystring params as the payload
// coexists safely with that file's own "lead" | "client" rows without
// touching that file at all.

export interface PriorityQueueView {
  id: string;
  name: string;
  params: Record<string, string>;
  createdAt: string;
}

interface StoredPriorityQueueFilters {
  kind: "priority_queue";
  params: Record<string, string>;
}

export async function savePriorityQueueView(name: string, params: Record<string, string>): Promise<ActionResult & { viewId?: string }> {
  const auth_ = await requireSession();
  if ("error" in auth_) return auth_.error;
  const { userId, organizationId } = auth_;
  if (!name.trim()) return { ok: false, error: "Give this view a name." };

  const saved = await prisma.savedSearch.create({
    data: {
      organizationId,
      userId,
      name: name.trim(),
      filters: { kind: "priority_queue", params } satisfies StoredPriorityQueueFilters,
    },
  });

  revalidatePath(REVALIDATE_PATH);
  return { ok: true, viewId: saved.id };
}

export async function listPriorityQueueViews(): Promise<PriorityQueueView[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];
  const membership = await resolveActiveMembership(userId);
  if (!membership) return [];

  const rows = await prisma.savedSearch.findMany({
    where: { organizationId: membership.organizationId, userId },
    orderBy: { createdAt: "desc" },
  });

  return rows
    .map((row) => {
      const stored = row.filters as unknown as StoredPriorityQueueFilters;
      if (stored?.kind !== "priority_queue") return null;
      return { id: row.id, name: row.name, params: stored.params ?? {}, createdAt: row.createdAt.toISOString() };
    })
    .filter((v): v is PriorityQueueView => v !== null);
}

export async function deletePriorityQueueView(id: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const existing = await prisma.savedSearch.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) return { ok: false, error: "Saved view not found." };

  await prisma.savedSearch.delete({ where: { id } });
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}
