"use server";

import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildClientSummary, askAboutClient, type ClientSummary, type AskAiAnswer } from "@/lib/business-development/client-360";
import { getCompanyCompleteTimeline, type TimelineEntry } from "@/lib/business-development/company-complete-timeline";

import { resolveMembershipForCompany } from "./intelligence-actions";

/**
 * Phase 5 (Client 360 / Account 360) — API surface. Same session/tenant-
 * isolation pattern as every other _lib actions file this session
 * (reused, not reinvented): auth() + resolveMembershipForCompany enforces
 * organization_id + company_id at the service layer, never relying on
 * frontend filtering (rule 19/26).
 */

export interface Client360ActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function requireCompanyAccess(companyId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const resolved = await resolveMembershipForCompany(userId, companyId);
  if (!resolved) return { ok: false as const, error: "Company not found." };
  return { ok: true as const, organizationId: resolved.membership.organizationId };
}

/** GET Client 360 summary — the grounded, CONFIRMED/INFERRED/UNKNOWN-labeled relationship summary. */
export async function getClient360SummaryAction(companyId: string): Promise<Client360ActionResult<ClientSummary | null>> {
  const access = await requireCompanyAccess(companyId);
  if (!access.ok) return { ok: false, error: access.error };
  const data = await buildClientSummary(access.organizationId, companyId);
  return { ok: true, data };
}

export interface TimelineFilters {
  eventTypes?: string[];
  actor?: string;
  dateFrom?: string;
  dateTo?: string;
  order?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export interface PaginatedTimeline {
  entries: TimelineEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET Client Timeline — filterable/paginated over the real, fully-composed timeline (never re-queries per filter — filters/pagination apply to the already-bounded real array). */
export async function getClientTimelineAction(companyId: string, filters: TimelineFilters = {}): Promise<Client360ActionResult<PaginatedTimeline>> {
  const access = await requireCompanyAccess(companyId);
  if (!access.ok) return { ok: false, error: access.error };

  let entries = await getCompanyCompleteTimeline(access.organizationId, companyId);

  if (filters.eventTypes && filters.eventTypes.length > 0) entries = entries.filter((e) => filters.eventTypes!.includes(e.type));
  if (filters.actor) entries = entries.filter((e) => e.actor === filters.actor);
  if (filters.dateFrom) entries = entries.filter((e) => e.occurredAt >= new Date(filters.dateFrom!));
  if (filters.dateTo) entries = entries.filter((e) => e.occurredAt <= new Date(filters.dateTo!));
  if (filters.order === "newest") entries = [...entries].reverse();

  const pageSize = Math.min(filters.pageSize ?? 50, 200);
  const page = Math.max(filters.page ?? 1, 1);
  const total = entries.length;
  const start = (page - 1) * pageSize;
  const paged = entries.slice(start, start + pageSize);

  return { ok: true, data: { entries: paged, total, page, pageSize } };
}

/** POST Ask AI About This Client — grounded strictly in this company's real records, tenant-isolated. */
export async function askAboutClientAction(companyId: string, question: string): Promise<Client360ActionResult<AskAiAnswer>> {
  const access = await requireCompanyAccess(companyId);
  if (!access.ok) return { ok: false, error: access.error };

  if (!question.trim()) return { ok: false, error: "Enter a question." };
  const session = await auth();
  if (!checkRateLimit(`ask-ai-client:${session!.user!.id}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many questions — wait a few minutes and try again." };
  }

  const data = await askAboutClient(access.organizationId, companyId, question.trim());
  return { ok: true, data };
}
