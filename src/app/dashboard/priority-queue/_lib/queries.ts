import type { OpportunityPriority, BuyingStage, Prisma } from "@/generated/prisma/client";
import { isBuyingStage } from "@/lib/business-development/buying-stage-display";
import { PRIORITY_OPTIONS } from "../../opportunities/_lib/opportunity-display";

/**
 * Shared filter parsing + Prisma `where`/`orderBy` construction for the
 * Priority Queue — used by both the page (server-rendered table) and the
 * CSV export route, so "export respects the exact filters/sort currently on
 * screen" is structurally guaranteed rather than two independently
 * maintained query-builders drifting apart.
 */

export const PAGE_SIZE = 25;

export type SortKey = "priority" | "opportunityScore" | "leadScore" | "intentScore" | "company" | "aging";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "priority", label: "Priority (default)" },
  { value: "opportunityScore", label: "Opportunity score" },
  { value: "leadScore", label: "Lead score" },
  { value: "intentScore", label: "Intent score" },
  { value: "company", label: "Company name" },
  { value: "aging", label: "Oldest first" },
];

export interface PriorityQueueSearchParams {
  q?: string;
  priority?: string;
  minLeadScore?: string;
  minIntentScore?: string;
  minOpportunityScore?: string;
  service?: string;
  country?: string;
  industry?: string;
  owner?: string;
  buyingStage?: string;
  sort?: string;
  dir?: string;
  page?: string;
  snoozed?: string;
}

export interface ParsedPriorityQueueFilters {
  q?: string;
  priority?: OpportunityPriority;
  minLeadScore?: number;
  minIntentScore?: number;
  minOpportunityScore?: number;
  service?: string;
  country?: string;
  industry?: string;
  owner?: string; // "me" | "unassigned" | a real userId
  buyingStage?: BuyingStage;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  includeSnoozed: boolean;
}

function isOpportunityPriority(value: string | undefined): value is OpportunityPriority {
  return !!value && (PRIORITY_OPTIONS as readonly string[]).includes(value);
}

function parseMinScore(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function isSortKey(value: string | undefined): value is SortKey {
  return !!value && SORT_OPTIONS.some((o) => o.value === value);
}

export function parsePriorityQueueFilters(params: PriorityQueueSearchParams): ParsedPriorityQueueFilters {
  const pageRaw = Number(params.page?.trim());
  return {
    q: params.q?.trim() || undefined,
    priority: isOpportunityPriority(params.priority) ? params.priority : undefined,
    minLeadScore: parseMinScore(params.minLeadScore),
    minIntentScore: parseMinScore(params.minIntentScore),
    minOpportunityScore: parseMinScore(params.minOpportunityScore),
    service: params.service?.trim() || undefined,
    country: params.country?.trim() || undefined,
    industry: params.industry?.trim() || undefined,
    owner: params.owner?.trim() || undefined,
    buyingStage: isBuyingStage(params.buyingStage) ? params.buyingStage : undefined,
    sort: isSortKey(params.sort) ? params.sort : "priority",
    dir: params.dir === "asc" ? "asc" : "desc",
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? Math.floor(pageRaw) : 1,
    includeSnoozed: params.snoozed === "1",
  };
}

export function buildPriorityQueueWhere(
  organizationId: string,
  filters: ParsedPriorityQueueFilters,
  currentUserId: string,
): Prisma.LeadOpportunityWhereInput {
  const conditions: Prisma.LeadOpportunityWhereInput[] = [{ company: { organizationId } }];

  if (filters.priority) conditions.push({ priority: filters.priority });
  if (filters.minOpportunityScore !== undefined) conditions.push({ opportunityScore: { gte: filters.minOpportunityScore } });
  if (filters.minLeadScore !== undefined) conditions.push({ company: { leadScore: { overallScore: { gte: filters.minLeadScore } } } });
  if (filters.minIntentScore !== undefined) conditions.push({ company: { intentScore: { score: { gte: filters.minIntentScore } } } });
  if (filters.buyingStage) conditions.push({ company: { intentScore: { buyingStage: filters.buyingStage } } });
  if (filters.service) conditions.push({ recommendedService: filters.service });
  if (filters.country) conditions.push({ company: { headquartersCountry: filters.country } });
  if (filters.industry) conditions.push({ company: { industry: filters.industry } });

  if (filters.owner === "me") conditions.push({ ownerUserId: currentUserId });
  else if (filters.owner === "unassigned") conditions.push({ ownerUserId: null });
  else if (filters.owner) conditions.push({ ownerUserId: filters.owner });

  if (filters.q) {
    conditions.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { company: { name: { contains: filters.q, mode: "insensitive" } } },
      ],
    });
  }

  // Snoozed opportunities are hidden from the default queue view (they're
  // deliberately parked for later) unless the viewer explicitly asks to see
  // them via the "Snoozed" filter chip — never silently dropped from a
  // filtered/exported result the viewer asked for by owner/priority/etc.
  if (!filters.includeSnoozed) {
    conditions.push({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] });
  }

  return { AND: conditions };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Plain utility (not a component/hook), deliberately calling `Date.now()`
 * here rather than inline inside page.tsx's render body or a client
 * component — React's purity rules flag impure calls made directly inside a
 * component/hook, so every "what time is it right now" read for a Priority
 * Queue row happens once, server-side, through this function, and gets
 * passed down as a plain already-computed number/boolean prop.
 */
export function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / MS_PER_DAY));
}

export function isInFuture(date: Date | null): boolean {
  return date !== null && date.getTime() > Date.now();
}

export function buildPriorityQueueOrderBy(filters: ParsedPriorityQueueFilters): Prisma.LeadOpportunityOrderByWithRelationInput[] {
  const dir = filters.dir;
  switch (filters.sort) {
    case "opportunityScore":
      return [{ opportunityScore: { sort: dir, nulls: "last" } }];
    case "leadScore":
      return [{ company: { leadScore: { overallScore: dir } } }];
    case "intentScore":
      return [{ company: { intentScore: { score: dir } } }];
    case "company":
      return [{ company: { name: dir } }];
    case "aging":
      return [{ createdAt: dir === "desc" ? "asc" : "desc" }];
    case "priority":
    default:
      return [
        { priority: { sort: "asc", nulls: "last" } },
        { opportunityScore: { sort: "desc", nulls: "last" } },
      ];
  }
}
