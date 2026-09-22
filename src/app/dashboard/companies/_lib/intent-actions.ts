"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeIntentScore } from "@/lib/business-development/intent-scoring";
import { getIntentRecommendedAction, type RecommendedAction } from "@/lib/business-development/intent-recommendation";

import { resolveMembershipForCompany } from "./intelligence-actions";

/**
 * Phase 2 (Buying Intent Intelligence Engine) — API surface. Same pattern
 * as intelligence-actions.ts/enrichment-actions.ts (reused, not
 * reinvented): session auth, `resolveMembershipForCompany` for tenant
 * isolation, rate-limiting, structured results, never exposing another
 * organization's data.
 */

export interface CompanyIntentView {
  score: number;
  band: string;
  buyingStage: string;
  buyingStageReasoning: string;
  buyingStageConfidence: number;
  signals: unknown;
  reasoning: string;
  scoredAt: string;
}

export interface IntentActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function requireMembership(companyId: string): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  return { ok: true, organizationId: resolved.membership.organizationId };
}

/** GET company intent — score, band, buying stage, confidence, top signals, and the full explanation, all in one row (no separate "explanation" endpoint needed — the reasoning/signals ARE the explanation). */
export async function getCompanyIntentAction(companyId: string): Promise<IntentActionResult<CompanyIntentView | null>> {
  const membership = await requireMembership(companyId);
  if (!membership.ok) return { ok: false, error: membership.error };

  const intentScore = await prisma.intentScore.findUnique({ where: { companyId } });
  if (!intentScore) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      score: intentScore.score,
      band: intentScore.band,
      buyingStage: intentScore.buyingStage,
      buyingStageReasoning: intentScore.buyingStageReasoning,
      buyingStageConfidence: intentScore.buyingStageConfidence,
      signals: intentScore.signals,
      reasoning: intentScore.reasoning,
      scoredAt: intentScore.scoredAt.toISOString(),
    },
  };
}

export interface IntentHistoryEntry {
  previousScore: number | null;
  newScore: number;
  scoreChange: number;
  previousBand: string | null;
  newBand: string;
  previousStage: string | null;
  newStage: string;
  reason: string;
  triggerSignal: string | null;
  calculatedAt: string;
}

/** GET intent history — real score/stage change log, oldest first, never overwritten. */
export async function getIntentHistoryAction(companyId: string): Promise<IntentActionResult<IntentHistoryEntry[]>> {
  const membership = await requireMembership(companyId);
  if (!membership.ok) return { ok: false, error: membership.error };

  const rows = await prisma.intentScoreHistory.findMany({ where: { companyId }, orderBy: { calculatedAt: "asc" } });

  return {
    ok: true,
    data: rows.map((r) => ({
      previousScore: r.previousScore,
      newScore: r.newScore,
      scoreChange: r.scoreChange,
      previousBand: r.previousBand,
      newBand: r.newBand,
      previousStage: r.previousStage,
      newStage: r.newStage,
      reason: r.reason,
      triggerSignal: r.triggerSignal,
      calculatedAt: r.calculatedAt.toISOString(),
    })),
  };
}

/** GET recommended action — who to contact, what service, why, via which channel. Never sends anything. */
export async function getRecommendedActionAction(companyId: string): Promise<IntentActionResult<RecommendedAction>> {
  const membership = await requireMembership(companyId);
  if (!membership.ok) return { ok: false, error: membership.error };

  const data = await getIntentRecommendedAction(companyId);
  return { ok: true, data };
}

/** POST/recalculate — manual "recompute intent now" trigger, rate-limited, session-gated, tenant-isolated. */
export async function recalculateIntentAction(companyId: string): Promise<IntentActionResult<CompanyIntentView>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  if (!checkRateLimit(`recalc-intent:${userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many recalculation requests — wait a few minutes and try again." };
  }

  const result = await computeIntentScore(companyId);
  if (!result) return { ok: false, error: "Company not found." };

  await logAudit({
    userId,
    organizationId: resolved.membership.organizationId,
    action: "intent.recalculate.manual",
    metadata: { companyId, score: result.score, band: result.band, buyingStage: result.buyingStage },
  });

  revalidatePath(`/dashboard/companies/${companyId}`);

  return {
    ok: true,
    data: {
      score: result.score,
      band: result.band,
      buyingStage: result.buyingStage,
      buyingStageReasoning: result.buyingStageReasoning,
      buyingStageConfidence: result.buyingStageConfidence,
      signals: result.signals,
      reasoning: result.reasoning,
      scoredAt: new Date().toISOString(),
    },
  };
}
