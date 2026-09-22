"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approveRecommendation, rejectRecommendation } from "@/lib/learning/recommendations";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** OWNER/ADMIN only — same APPROVER_ROLES convention as outreach/_lib/approval-actions.ts. Never touches any production rule itself — only this row's own status (§32). */
const APPROVER_ROLES = new Set(["OWNER", "ADMIN"]);

async function resolveApproverMembership(userId: string) {
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership || !APPROVER_ROLES.has(membership.role)) return null;
  return membership;
}

export async function approveRecommendationAction(recommendationId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveApproverMembership(userId);
  if (!membership) return { ok: false, error: "Only an OWNER or ADMIN can approve a learning recommendation." };

  try {
    await approveRecommendation(membership.organizationId, recommendationId, userId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to approve." };
  }
  revalidatePath("/dashboard/learning/recommendations");
  return { ok: true };
}

export async function rejectRecommendationAction(recommendationId: string, reason?: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveApproverMembership(userId);
  if (!membership) return { ok: false, error: "Only an OWNER or ADMIN can reject a learning recommendation." };

  try {
    await rejectRecommendation(membership.organizationId, recommendationId, userId, reason);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to reject." };
  }
  revalidatePath("/dashboard/learning/recommendations");
  return { ok: true };
}
