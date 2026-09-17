import type { PartnerType, ReferralPartnerStatus } from "@/generated/prisma/client";

/**
 * Pure display-mapping helpers for the Partner Portal
 * (/dashboard/referral-partners) — kept free of Prisma calls / React so they
 * can be unit-tested in isolation (see referral-partner-display.test.ts),
 * same split as opportunities/_lib/opportunity-display.ts. Deliberately its
 * own file rather than reusing opportunity-display.ts — this is a different
 * feature area (Phase 8's ReferralPartner/PartnerCommission models, not
 * LeadOpportunity), per this session's established per-feature
 * `_lib/*-display.ts` convention.
 */

/** Declaration order mirrors PartnerType's native Postgres enum order in schema.prisma. */
export const PARTNER_TYPE_OPTIONS: PartnerType[] = [
  "FREELANCER",
  "DIGITAL_AGENCY",
  "SEO_AGENCY",
  "MARKETING_CONSULTANT",
  "IT_CONSULTANT",
  "BUSINESS_CONSULTANT",
  "DESIGNER",
  "TECHNOLOGY_CONSULTANT",
];

export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = {
  FREELANCER: "Freelancer",
  DIGITAL_AGENCY: "Digital Agency",
  SEO_AGENCY: "SEO Agency",
  MARKETING_CONSULTANT: "Marketing Consultant",
  IT_CONSULTANT: "IT Consultant",
  BUSINESS_CONSULTANT: "Business Consultant",
  DESIGNER: "Designer",
  TECHNOLOGY_CONSULTANT: "Technology Consultant",
};

/**
 * `ReferralPartner.type` is nullable in schema.prisma (a manually-added
 * partner may not have a type set yet) — this never guesses one, it just
 * reports the honest "Unspecified" fallback.
 */
export function partnerTypeLabel(type: PartnerType | null): string {
  if (!type) return "Unspecified";
  return PARTNER_TYPE_LABEL[type];
}

/** Declaration order mirrors ReferralPartnerStatus's native Postgres enum order in schema.prisma. */
export const PARTNER_STATUS_OPTIONS: ReferralPartnerStatus[] = ["CANDIDATE", "ACTIVE", "INACTIVE"];

export const PARTNER_STATUS_LABEL: Record<ReferralPartnerStatus, string> = {
  CANDIDATE: "Candidate",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

/**
 * CANDIDATE (AI-discovered, not yet recruited) deliberately reads as muted —
 * the same "not yet real" treatment as DISMISSED in opportunity-display.ts —
 * so it visually reads differently from a genuinely recruited ACTIVE
 * partner (emerald, matching this session's "live/good" convention
 * elsewhere). INACTIVE (churned) gets its own distinct slate band rather
 * than reusing CANDIDATE's, since the two mean very different things even
 * though both are "not currently active".
 */
export const PARTNER_STATUS_BADGE_CLASSNAME: Record<ReferralPartnerStatus, string> = {
  CANDIDATE: "border-border bg-muted text-muted-foreground",
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  INACTIVE: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400",
};

/** Pure formatter for `ReferralPartner.commissionRatePercent` (a real, stored policy value — see schema doc). */
export function formatCommissionRate(commissionRatePercent: number): string {
  return `${commissionRatePercent}%`;
}

export interface ReferralPartnerAggregateStats {
  companiesReferred: number;
  leadsReferred: number;
  dealsCount: number;
  revenue: number;
  commissionTotal: number;
  pendingPayout: number;
  paidPayout: number;
}

/**
 * Pure aggregation over the real relation chain — no fabricated numbers.
 * `companies` is `partner.referredCompanies` each carrying its own real
 * `leads`/`deals` sub-selections, `commissions` is `partner.commissions`.
 * Shared by both the list page (per-partner summary row) and the detail
 * page (single-partner profile stats), so the two surfaces can never
 * disagree about how a total is computed.
 */
export function aggregateReferralPartnerStats(input: {
  companies: Array<{ leads: Array<{ id: string }>; deals: Array<{ value: number | null }> }>;
  commissions: Array<{ amount: number; status: "PENDING" | "PAID" }>;
}): ReferralPartnerAggregateStats {
  const deals = input.companies.flatMap((company) => company.deals);

  return {
    companiesReferred: input.companies.length,
    leadsReferred: input.companies.reduce((sum, company) => sum + company.leads.length, 0),
    dealsCount: deals.length,
    revenue: deals.reduce((sum, deal) => sum + (deal.value ?? 0), 0),
    commissionTotal: input.commissions.reduce((sum, commission) => sum + commission.amount, 0),
    pendingPayout: input.commissions
      .filter((commission) => commission.status === "PENDING")
      .reduce((sum, commission) => sum + commission.amount, 0),
    paidPayout: input.commissions
      .filter((commission) => commission.status === "PAID")
      .reduce((sum, commission) => sum + commission.amount, 0),
  };
}
