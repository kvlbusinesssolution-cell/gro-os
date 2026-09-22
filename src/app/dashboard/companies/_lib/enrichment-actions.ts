"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { enrichCompany, enrichContact } from "@/lib/business-development/enrichment";

import { resolveMembershipForCompany } from "./intelligence-actions";

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — the Company/Contact
 * enrichment API surface (server actions, this platform's real API layer —
 * see intelligence-actions.ts for the exact same pattern this mirrors).
 * Every action here: authenticates, resolves the caller's ACTIVE membership,
 * verifies the target row belongs to that SAME organization (tenant
 * isolation — never trusts a client-supplied id alone), rate-limits, and
 * never marks success unless enrichCompany/enrichContact's own step-tracking
 * says so.
 */

const MAX_BATCH_SIZE = 20;

export interface EnrichActionResult {
  ok: boolean;
  status?: string;
  error?: string;
}

export async function enrichCompanyAction(companyId: string): Promise<EnrichActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  if (!checkRateLimit(`enrich-company:${userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many enrichment requests — wait a few minutes and try again." };
  }

  try {
    const { status } = await enrichCompany(companyId, { triggeredBy: "MANUAL", triggeredByUserId: userId });

    await logAudit({
      userId,
      organizationId: resolved.membership.organizationId,
      action: "enrichment.company.manual",
      metadata: { companyId, status },
    });

    revalidatePath(`/dashboard/companies/${companyId}`);
    return { ok: true, status };
  } catch (error) {
    console.error("[enrichment-actions] enrichCompanyAction failed:", error);
    return { ok: false, error: "Enrichment failed. Please try again." };
  }
}

export async function enrichContactAction(contactId: string): Promise<EnrichActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false, error: "No active organization membership." };

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return { ok: false, error: "Contact not found." };

  if (!checkRateLimit(`enrich-contact:${userId}`, { limit: 40, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many enrichment requests — wait a few minutes and try again." };
  }

  try {
    const { status } = await enrichContact(contactId, { triggeredBy: "MANUAL", triggeredByUserId: userId });

    await logAudit({
      userId,
      organizationId: membership.organizationId,
      action: "enrichment.contact.manual",
      metadata: { contactId, status },
    });

    if (contact.companyId) revalidatePath(`/dashboard/companies/${contact.companyId}`);
    return { ok: true, status };
  } catch (error) {
    console.error("[enrichment-actions] enrichContactAction failed:", error);
    return { ok: false, error: "Enrichment failed. Please try again." };
  }
}

export interface BatchEnrichSummary {
  ok: boolean;
  completed: number;
  partial: number;
  failed: number;
  error?: string;
}

/**
 * Batch company enrichment — capped at MAX_BATCH_SIZE and processed
 * SEQUENTIALLY (never in parallel), matching the codebase's existing
 * "respect provider rate limits, never unbounded" discipline (same
 * reasoning as lead-discovery's "capped at 3 queries"/company-research-
 * job's MAX_COMPANIES_PER_RUN). Every id is verified to belong to the
 * caller's own organization before any work starts — a single foreign id
 * in the batch rejects the whole call rather than silently skipping it.
 */
export async function batchEnrichCompaniesAction(companyIds: string[]): Promise<BatchEnrichSummary> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, completed: 0, partial: 0, failed: 0, error: "You must be signed in." };

  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false, completed: 0, partial: 0, failed: 0, error: "No active organization membership." };

  if (companyIds.length === 0) return { ok: false, completed: 0, partial: 0, failed: 0, error: "No companies selected." };
  if (companyIds.length > MAX_BATCH_SIZE) {
    return { ok: false, completed: 0, partial: 0, failed: 0, error: `Batch limited to ${MAX_BATCH_SIZE} companies at a time.` };
  }

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, organizationId: membership.organizationId } });
  if (companies.length !== companyIds.length) {
    return { ok: false, completed: 0, partial: 0, failed: 0, error: "One or more companies not found in your organization." };
  }

  if (!checkRateLimit(`enrich-batch:${userId}`, { limit: 5, windowMs: 10 * 60_000 }).allowed) {
    return { ok: false, completed: 0, partial: 0, failed: 0, error: "Too many batch enrichment requests — wait a few minutes and try again." };
  }

  let completed = 0;
  let partial = 0;
  let failed = 0;

  for (const company of companies) {
    try {
      const { status } = await enrichCompany(company.id, { triggeredBy: "BATCH", triggeredByUserId: userId });
      if (status === "COMPLETED") completed += 1;
      else if (status === "PARTIAL") partial += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[enrichment-actions] batch enrichment failed for company ${company.id}:`, error);
    }
  }

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "enrichment.company.batch",
    metadata: { requested: companyIds.length, completed, partial, failed },
  });

  revalidatePath("/dashboard/companies");
  return { ok: true, completed, partial, failed };
}
