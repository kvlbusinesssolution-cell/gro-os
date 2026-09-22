"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { researchCompany, refreshResearchIfStale, buildCompanyResearchReport, type CompanyResearchReport } from "@/lib/business-development/company-research";

import { resolveMembershipForCompany } from "./intelligence-actions";

/**
 * Phase 3 (AI Company Research Engine) — API surface. Same session/tenant-
 * isolation/rate-limit pattern as intelligence-actions.ts / enrichment-
 * actions.ts / intent-actions.ts (all reused, not reinvented).
 */

export interface ResearchActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const MAX_QUEUE_BATCH = 20;

/** POST research — "Research Now". */
export async function researchCompanyAction(companyId: string): Promise<ResearchActionResult<{ status: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  if (!checkRateLimit(`research-company:${userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many research requests — wait a few minutes and try again." };
  }

  const run = await researchCompany(companyId, { triggeredBy: "MANUAL", triggeredByUserId: userId });

  await logAudit({ userId, organizationId: resolved.membership.organizationId, action: "research.company.manual", metadata: { companyId, status: run.status } });
  revalidatePath(`/dashboard/companies/${companyId}`);

  return { ok: true, data: { status: run.status } };
}

/** POST refresh research — respects staleness ("No Significant Change" when not stale). */
export async function refreshResearchAction(companyId: string): Promise<ResearchActionResult<{ refreshed: boolean; reason: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  if (!checkRateLimit(`research-refresh:${userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many research requests — wait a few minutes and try again." };
  }

  const result = await refreshResearchIfStale(companyId, { triggeredBy: "MANUAL", triggeredByUserId: userId });

  await logAudit({ userId, organizationId: resolved.membership.organizationId, action: "research.company.refresh", metadata: { companyId, refreshed: result.refreshed } });
  if (result.refreshed) revalidatePath(`/dashboard/companies/${companyId}`);

  return { ok: true, data: { refreshed: result.refreshed, reason: result.reason } };
}

/** POST queue research — batch "Queue Research" for authorized records, capped and sequential (respects AI provider rate limits, same discipline as batchEnrichCompaniesAction). */
export async function queueResearchAction(companyIds: string[]): Promise<ResearchActionResult<{ completed: number; partial: number; failed: number }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false, error: "No active organization membership." };

  if (companyIds.length === 0) return { ok: false, error: "No companies selected." };
  if (companyIds.length > MAX_QUEUE_BATCH) return { ok: false, error: `Batch limited to ${MAX_QUEUE_BATCH} companies at a time.` };

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, organizationId: membership.organizationId } });
  if (companies.length !== companyIds.length) return { ok: false, error: "One or more companies not found in your organization." };

  if (!checkRateLimit(`research-queue:${userId}`, { limit: 5, windowMs: 10 * 60_000 }).allowed) {
    return { ok: false, error: "Too many batch research requests — wait a few minutes and try again." };
  }

  let completed = 0;
  let partial = 0;
  let failed = 0;
  for (const company of companies) {
    try {
      const run = await researchCompany(company.id, { triggeredBy: "BATCH", triggeredByUserId: userId });
      if (run.status === "COMPLETED") completed += 1;
      else if (run.status === "PARTIAL") partial += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[research-actions] queued research failed for company ${company.id}:`, error);
    }
  }

  await logAudit({ userId, organizationId: membership.organizationId, action: "research.company.queue", metadata: { requested: companyIds.length, completed, partial, failed } });
  revalidatePath("/dashboard/companies");

  return { ok: true, data: { completed, partial, failed } };
}

/** GET company research — the composed report. */
export async function getCompanyResearchReportAction(companyId: string): Promise<ResearchActionResult<CompanyResearchReport | null>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  const data = await buildCompanyResearchReport(companyId);
  return { ok: true, data };
}

export interface ResearchHistoryEntry {
  id: string;
  status: string;
  triggeredBy: string;
  stepsCompleted: string[];
  stepsFailed: string[];
  factsFound: number;
  confidence: number | null;
  aiProvider: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** GET research history. */
export async function getResearchHistoryAction(companyId: string): Promise<ResearchActionResult<ResearchHistoryEntry[]>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  const runs = await prisma.enrichmentRun.findMany({
    where: { companyId, entityType: "COMPANY" },
    orderBy: { startedAt: "desc" },
  });

  return {
    ok: true,
    data: runs.map((r) => ({
      id: r.id,
      status: r.status,
      triggeredBy: r.triggeredBy,
      stepsCompleted: r.stepsCompleted,
      stepsFailed: r.stepsFailed,
      factsFound: r.factsFound,
      confidence: r.confidence,
      aiProvider: r.aiProvider,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}

/** GET research evidence — same real CompanyEvidence rows the Phase 1 evidence panel already shows, exposed here as its own endpoint per the spec's API list (no second evidence store). */
export async function getResearchEvidenceAction(companyId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false as const, error: "Company not found." };

  const evidence = await prisma.companyEvidence.findMany({ where: { companyId }, orderBy: { discoveredAt: "desc" } });
  return { ok: true as const, data: evidence };
}

/** GET research status — the lightweight status-only check (for polling without pulling the full report). */
export async function getResearchStatusAction(companyId: string): Promise<ResearchActionResult<{ status: string; lastResearchedAt: string | null }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { enrichmentStatus: true, lastEnrichedAt: true } });
  return { ok: true, data: { status: company.enrichmentStatus, lastResearchedAt: company.lastEnrichedAt?.toISOString() ?? null } };
}
