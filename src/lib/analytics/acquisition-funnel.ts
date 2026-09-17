import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";
import type { CompanySource } from "@/generated/prisma/enums";

/**
 * Revenue & Client Acquisition Intelligence — "Where are clients coming
 * from? Which sources generate opportunities/meetings/proposals/won deals?"
 *
 * Every number below is a real Prisma count()/aggregate({_sum})/groupBy()
 * over already-stored rows, scoped to `organizationId` and (optionally) a
 * date range. Nothing here is estimated, forecasted, or AI-generated — see
 * the per-field comments for the exact real basis of each metric, matching
 * the documented-not-fabricated discipline already established by
 * src/lib/analytics.ts and src/lib/lead-analytics.ts.
 *
 * ===== "Qualified lead" definition (do not redefine elsewhere) =====
 * Reused, not reinvented: a "qualified lead" is a Company whose LeadScore.band
 * is HOT or WARM. This is the exact definition `getCompanyStats` already uses
 * in src/lib/lead-analytics.ts, which is what the "Qualified leads" stat
 * (icon Flame) on /dashboard/companies shows today
 * (src/app/dashboard/companies/_components/company-stats-strip.tsx). A
 * second, narrower notion of "qualified" exists in
 * src/lib/business-development/decision-maker-sync-job.ts ("has at least one
 * LeadOpportunity") but that is scoped to that job's own targeting logic, not
 * a general "qualified lead" definition, and using it here would collapse
 * the funnel's "Qualified Leads" and "Opportunities" stages into the same
 * set. LeadScore.band is the real, already-user-facing definition, and it
 * sits naturally between "Companies" and "Opportunities" in the funnel.
 *
 * ===== "Won" deal definition =====
 * `dealStage.name === "Won"` — the exact convention already established in
 * src/lib/analytics.ts (`getRevenueByCompany`, `ensureTodaySnapshot`).
 *
 * ===== Source taxonomy =====
 * `Company.source` (`CompanySource`) is the only real, stored "source"
 * field in this schema: MANUAL, LEAD_FINDER, CLIENT_FINDER,
 * WEBSITE_SCANNER, AUTO_DISCOVERY, REFERRAL. The spec's illustrative list
 * (Web Search / Website Scanner / Directories / Imports / LinkedIn / Email
 * Outreach / Referrals / Partners / Inbound / Existing clients) does not map
 * 1:1 onto this enum — Directories, Imports, LinkedIn (as a source),
 * Email Outreach (as a source), Inbound, and Existing clients have no
 * dedicated stored field anywhere in this codebase today. Rather than invent
 * a fake bucket for them, `bySource` below reports exactly the 6 real
 * `CompanySource` values and nothing else.
 *
 * ===== Date range =====
 * When `dateRange` is given, every count/sum is filtered on that row's own
 * most meaningful timestamp (Company.createdAt, LeadScore.scoredAt,
 * LeadOpportunity.createdAt, Contact.createdAt, EmailDraft.sentAt,
 * Reply.receivedAt, OutreachMeeting.createdAt, Proposal.createdAt,
 * Deal.createdAt) — never a single shared column that doesn't exist on that
 * model. Omitting `dateRange` computes all-time.
 */

export interface AcquisitionFunnelStage {
  stage: string;
  count: number;
}

export interface SourceBreakdown {
  source: string;
  companies: number;
  qualifiedLeads: number;
  opportunities: number;
  meetings: number;
  proposals: number;
  wonDeals: number;
  revenue: number;
}

export interface CampaignBreakdown {
  campaignId: string;
  campaignName: string;
  contactsEnrolled: number;
  emailsSent: number;
  replies: number;
  meetings: number;
  wonDeals: number;
  revenue: number;
}

export interface AcquisitionOverview {
  funnel: AcquisitionFunnelStage[];
  totalRevenue: number;
  bySource: SourceBreakdown[];
  byIndustry: Array<{ industry: string; companies: number; wonDeals: number; revenue: number }>;
  byCountry: Array<{ country: string; companies: number; wonDeals: number; revenue: number }>;
  byService: Array<{ service: string; opportunities: number; wonDeals: number; revenue: number }>;
  byCampaign: CampaignBreakdown[];
}

const QUALIFIED_BANDS = ["HOT", "WARM"] as const;
const REAL_MEETING_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

// Schema declaration order — see enum CompanySource in prisma/schema.prisma.
const ALL_COMPANY_SOURCES: CompanySource[] = [
  "MANUAL",
  "LEAD_FINDER",
  "CLIENT_FINDER",
  "WEBSITE_SCANNER",
  "AUTO_DISCOVERY",
  "REFERRAL",
];

interface DateRange {
  from: Date;
  to: Date;
}

/** `undefined` (no filter) when `range` is omitted — an all-time query. */
function rangeFilter(range: DateRange | undefined): { gte: Date; lte: Date } | undefined {
  return range ? { gte: range.from, lte: range.to } : undefined;
}

export async function computeAcquisitionOverview(
  organizationId: string,
  dateRange?: { from: Date; to: Date },
): Promise<AcquisitionOverview> {
  const range = rangeFilter(dateRange);

  const [
    companiesCount,
    qualifiedLeadsCount,
    opportunitiesCount,
    contactsCount,
    outreachSentCount,
    repliesCount,
    meetingsCount,
    proposalsCount,
    wonDealsCount,
    revenueAgg,
  ] = await Promise.all([
    prisma.company.count({ where: { organizationId, createdAt: range } }),
    prisma.leadScore.count({
      where: { company: { organizationId }, band: { in: [...QUALIFIED_BANDS] }, scoredAt: range },
    }),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, createdAt: range } }),
    prisma.contact.count({ where: { organizationId, createdAt: range } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT", sentAt: range } }),
    prisma.reply.count({ where: { organizationId, receivedAt: range } }),
    prisma.outreachMeeting.count({
      where: { organizationId, status: { in: [...REAL_MEETING_STATUSES] }, createdAt: range },
    }),
    prisma.proposal.count({ where: { organizationId, createdAt: range } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" }, createdAt: range } }),
    prisma.deal.aggregate({
      where: { organizationId, dealStage: { name: "Won" }, createdAt: range },
      _sum: { value: true },
    }),
  ]);

  const funnel: AcquisitionFunnelStage[] = [
    { stage: "Companies", count: companiesCount },
    { stage: "Qualified Leads", count: qualifiedLeadsCount },
    { stage: "Opportunities", count: opportunitiesCount },
    { stage: "Contacts", count: contactsCount },
    { stage: "Outreach Sent", count: outreachSentCount },
    { stage: "Replies", count: repliesCount },
    { stage: "Meetings", count: meetingsCount },
    { stage: "Proposals", count: proposalsCount },
    { stage: "Won Deals", count: wonDealsCount },
  ];

  const totalRevenue = revenueAgg._sum.value ?? 0;

  const [bySource, byIndustry, byCountry, byService, byCampaign] = await Promise.all([
    computeBySource(organizationId, range),
    computeByIndustry(organizationId, range),
    computeByCountry(organizationId, range),
    computeByService(organizationId, range),
    computeByCampaign(organizationId, range),
  ]);

  return { funnel, totalRevenue, bySource, byIndustry, byCountry, byService, byCampaign };
}

/**
 * `bySource` cannot use a single `groupBy` for every metric: `LeadScore`,
 * `LeadOpportunity`, `OutreachMeeting`, `Proposal`, and `Deal` don't carry
 * `Company.source` themselves, only a relation to the Company that does. So
 * each metric below is one real query (never N+1 per source) that selects
 * the related `company.source` and is reduced into per-source buckets in
 * application code — the same "fetch once, group in JS" pattern already used
 * by `getRevenueByCompany`/`technologyTrends` in this codebase.
 */
async function computeBySource(organizationId: string, range: { gte: Date; lte: Date } | undefined): Promise<SourceBreakdown[]> {
  const [companyGroups, qualifiedLeadRows, opportunityRows, meetingRows, proposalRows, dealRows] = await Promise.all([
    prisma.company.groupBy({
      by: ["source"],
      where: { organizationId, createdAt: range },
      _count: { source: true },
    }),
    prisma.leadScore.findMany({
      where: { company: { organizationId }, band: { in: [...QUALIFIED_BANDS] }, scoredAt: range },
      select: { company: { select: { source: true } } },
    }),
    prisma.leadOpportunity.findMany({
      where: { company: { organizationId }, createdAt: range },
      select: { company: { select: { source: true } } },
    }),
    prisma.outreachMeeting.findMany({
      where: { organizationId, status: { in: [...REAL_MEETING_STATUSES] }, createdAt: range },
      select: { contact: { select: { company: { select: { source: true } } } } },
    }),
    prisma.proposal.findMany({
      where: { organizationId, createdAt: range },
      select: { company: { select: { source: true } } },
    }),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: "Won" }, createdAt: range },
      select: { value: true, company: { select: { source: true } } },
    }),
  ]);

  const companiesBySource = new Map(companyGroups.map((g) => [g.source, g._count.source]));
  const qualifiedLeadsBySource = countBy(qualifiedLeadRows, (r) => r.company?.source);
  const opportunitiesBySource = countBy(opportunityRows, (r) => r.company?.source);
  const meetingsBySource = countBy(meetingRows, (r) => r.contact.company?.source);
  const proposalsBySource = countBy(proposalRows, (r) => r.company?.source);

  const wonDealsBySource = new Map<CompanySource, number>();
  const revenueBySource = new Map<CompanySource, number>();
  for (const deal of dealRows) {
    const source = deal.company?.source;
    if (!source) continue;
    wonDealsBySource.set(source, (wonDealsBySource.get(source) ?? 0) + 1);
    revenueBySource.set(source, (revenueBySource.get(source) ?? 0) + (deal.value ?? 0));
  }

  return ALL_COMPANY_SOURCES.map((source) => ({
    source,
    companies: companiesBySource.get(source) ?? 0,
    qualifiedLeads: qualifiedLeadsBySource.get(source) ?? 0,
    opportunities: opportunitiesBySource.get(source) ?? 0,
    meetings: meetingsBySource.get(source) ?? 0,
    proposals: proposalsBySource.get(source) ?? 0,
    wonDeals: wonDealsBySource.get(source) ?? 0,
    revenue: revenueBySource.get(source) ?? 0,
  }));
}

function countBy<T>(rows: T[], keyOf: (row: T) => string | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * A `Deal`'s industry/country is inherited from its linked `Company` — Deal
 * has no `industry`/`country` field of its own. Company-count-by-industry
 * uses a real `groupBy` (industry lives directly on Company); won-deal
 * count/revenue-by-industry is fetched once (Won deals with their company's
 * industry) and reduced in application code, then merged with the company
 * groups so an industry that only shows up via a Won deal (e.g. the company
 * was created outside `dateRange` but its deal closed inside it) is never
 * silently dropped.
 */
async function computeByIndustry(
  organizationId: string,
  range: { gte: Date; lte: Date } | undefined,
): Promise<Array<{ industry: string; companies: number; wonDeals: number; revenue: number }>> {
  const [industryGroups, dealRows] = await Promise.all([
    prisma.company.groupBy({
      by: ["industry"],
      where: { organizationId, industry: { not: null }, createdAt: range },
      _count: { industry: true },
    }),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: "Won" }, createdAt: range, company: { industry: { not: null } } },
      select: { value: true, company: { select: { industry: true } } },
    }),
  ]);

  const companiesByIndustry = new Map(industryGroups.map((g) => [g.industry as string, g._count.industry]));
  const wonDealsByIndustry = new Map<string, number>();
  const revenueByIndustry = new Map<string, number>();
  for (const deal of dealRows) {
    const industry = deal.company?.industry;
    if (!industry) continue;
    wonDealsByIndustry.set(industry, (wonDealsByIndustry.get(industry) ?? 0) + 1);
    revenueByIndustry.set(industry, (revenueByIndustry.get(industry) ?? 0) + (deal.value ?? 0));
  }

  const allIndustries = new Set([...companiesByIndustry.keys(), ...wonDealsByIndustry.keys()]);

  return [...allIndustries]
    .map((industry) => ({
      industry,
      companies: companiesByIndustry.get(industry) ?? 0,
      wonDeals: wonDealsByIndustry.get(industry) ?? 0,
      revenue: revenueByIndustry.get(industry) ?? 0,
    }))
    .sort((a, b) => b.companies - a.companies);
}

/** Same join-via-Company approach as `computeByIndustry`, keyed by `headquartersCountry`. */
async function computeByCountry(
  organizationId: string,
  range: { gte: Date; lte: Date } | undefined,
): Promise<Array<{ country: string; companies: number; wonDeals: number; revenue: number }>> {
  const [countryGroups, dealRows] = await Promise.all([
    prisma.company.groupBy({
      by: ["headquartersCountry"],
      where: { organizationId, headquartersCountry: { not: null }, createdAt: range },
      _count: { headquartersCountry: true },
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        dealStage: { name: "Won" },
        createdAt: range,
        company: { headquartersCountry: { not: null } },
      },
      select: { value: true, company: { select: { headquartersCountry: true } } },
    }),
  ]);

  const companiesByCountry = new Map(countryGroups.map((g) => [g.headquartersCountry as string, g._count.headquartersCountry]));
  const wonDealsByCountry = new Map<string, number>();
  const revenueByCountry = new Map<string, number>();
  for (const deal of dealRows) {
    const country = deal.company?.headquartersCountry;
    if (!country) continue;
    wonDealsByCountry.set(country, (wonDealsByCountry.get(country) ?? 0) + 1);
    revenueByCountry.set(country, (revenueByCountry.get(country) ?? 0) + (deal.value ?? 0));
  }

  const allCountries = new Set([...companiesByCountry.keys(), ...wonDealsByCountry.keys()]);

  return [...allCountries]
    .map((country) => ({
      country,
      companies: companiesByCountry.get(country) ?? 0,
      wonDeals: wonDealsByCountry.get(country) ?? 0,
      revenue: revenueByCountry.get(country) ?? 0,
    }))
    .sort((a, b) => b.companies - a.companies);
}

/**
 * `LeadOpportunity.recommendedService` is a real `KVLServiceId` string
 * (see kvl-service-catalog.ts) but there is no schema link at all from a
 * `LeadOpportunity` forward to a `Proposal` or `Deal` — the codebase has
 * never stored "this deal fulfills that recommended service". The only real
 * join available is via `Company`: `opportunities` is a direct count of
 * `LeadOpportunity` rows per service; `wonDeals`/`revenue` are attributed by
 * matching each Won Deal's `companyId` against the (real, distinct)
 * company↔service pairs that company's own LeadOpportunities carry. This is
 * honest, not invented — but it means a company whose LeadOpportunities
 * recommend two different services will have that one Won Deal's value
 * counted once per matching service, since the schema has no way to say
 * which single recommendation the deal actually closed on.
 */
async function computeByService(
  organizationId: string,
  range: { gte: Date; lte: Date } | undefined,
): Promise<Array<{ service: string; opportunities: number; wonDeals: number; revenue: number }>> {
  const [serviceGroups, companyServicePairs, dealRows] = await Promise.all([
    prisma.leadOpportunity.groupBy({
      by: ["recommendedService"],
      where: { recommendedService: { not: null }, company: { organizationId }, createdAt: range },
      _count: { recommendedService: true },
    }),
    prisma.leadOpportunity.findMany({
      where: { recommendedService: { not: null }, company: { organizationId }, createdAt: range },
      select: { companyId: true, recommendedService: true },
      distinct: ["companyId", "recommendedService"],
    }),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: "Won" }, createdAt: range, companyId: { not: null } },
      select: { companyId: true, value: true },
    }),
  ]);

  const dealsByCompany = new Map<string, { count: number; revenue: number }>();
  for (const deal of dealRows) {
    if (!deal.companyId) continue;
    const current = dealsByCompany.get(deal.companyId) ?? { count: 0, revenue: 0 };
    current.count += 1;
    current.revenue += deal.value ?? 0;
    dealsByCompany.set(deal.companyId, current);
  }

  const wonDealsByService = new Map<string, number>();
  const revenueByService = new Map<string, number>();
  for (const pair of companyServicePairs) {
    const service = pair.recommendedService;
    if (!service) continue;
    const dealAgg = dealsByCompany.get(pair.companyId);
    if (!dealAgg) continue;
    wonDealsByService.set(service, (wonDealsByService.get(service) ?? 0) + dealAgg.count);
    revenueByService.set(service, (revenueByService.get(service) ?? 0) + dealAgg.revenue);
  }

  const result: Array<{ service: string; opportunities: number; wonDeals: number; revenue: number }> = [];
  for (const g of serviceGroups) {
    // Guaranteed non-null by the `where: { recommendedService: { not: null } }`
    // filter above — groupBy's return type just doesn't narrow on `where`.
    if (g.recommendedService === null) continue;
    const service = g.recommendedService;
    const label = KVL_SERVICES.find((s) => s.id === service)?.label ?? service;
    result.push({
      service: label,
      opportunities: g._count.recommendedService,
      wonDeals: wonDealsByService.get(service) ?? 0,
      revenue: revenueByService.get(service) ?? 0,
    });
  }

  return result.sort((a, b) => b.opportunities - a.opportunities);
}

/**
 * "Campaign conversion" — an across-all-campaigns breakdown, distinct from
 * `getCampaignAnalytics` (src/lib/outreach/campaign-analytics.ts), which is
 * scoped to one campaign at a time and drives the per-campaign detail view.
 * This reuses that function's exact field/status conventions
 * (EmailDraft.status === "SENT", Reply.campaignId — a direct field, not
 * joined via emailDraftId, matching what getCampaignAnalytics's own
 * `repliesCount` query does — and the file-wide REAL_MEETING_STATUSES
 * definition for "real" meetings) rather than inventing new ones.
 *
 * Every real `Campaign` in the org is always listed (like `bySource`'s fixed
 * `ALL_COMPANY_SOURCES` enumeration) so a campaign is never silently dropped
 * just because it has no activity inside `dateRange` — each per-campaign
 * number is independently zero in that case. `contactsEnrolled`/
 * `emailsSent`/`replies`/`meetings` are each filtered by that row's own
 * timestamp (`CampaignContact.enrolledAt` / `EmailDraft.sentAt` /
 * `Reply.receivedAt` / `OutreachMeeting.createdAt`) when `dateRange` is
 * given, matching this file's stated date-range discipline.
 *
 * `wonDeals`/`revenue` is the genuinely new cross-model join: Campaign has
 * no direct link to Deal, so it's reached via
 * Campaign -> CampaignContact -> Contact -> Company -> Deal, fetched once
 * and reduced in application code — the same "fetch once, group in JS"
 * technique `bySource` established. The CampaignContact enrollment mapping
 * itself is fetched all-time (not date-filtered), exactly like
 * `computeByIndustry`/`computeByCountry` never filter the Company by its own
 * `createdAt` when attributing a Won Deal to it — only the Deal's own
 * `createdAt` decides whether it's in range. A company reached via more than
 * one campaign's enrolled contacts has its Won Deal(s) attributed to EACH
 * such campaign — real, honest multi-attribution, the same documented
 * limitation `computeByService` already carries for a company whose
 * LeadOpportunities recommend more than one service.
 */
async function computeByCampaign(
  organizationId: string,
  range: { gte: Date; lte: Date } | undefined,
): Promise<CampaignBreakdown[]> {
  const [
    campaigns,
    contactsEnrolledGroups,
    emailsSentGroups,
    repliesGroups,
    meetingsGroups,
    campaignContactRows,
    dealRows,
  ] = await Promise.all([
    prisma.campaign.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.campaignContact.groupBy({
      by: ["campaignId"],
      where: { campaign: { organizationId }, enrolledAt: range },
      _count: { campaignId: true },
    }),
    prisma.emailDraft.groupBy({
      by: ["campaignId"],
      where: { organizationId, campaignId: { not: null }, status: "SENT", sentAt: range },
      _count: { campaignId: true },
    }),
    prisma.reply.groupBy({
      by: ["campaignId"],
      where: { organizationId, campaignId: { not: null }, receivedAt: range },
      _count: { campaignId: true },
    }),
    prisma.outreachMeeting.groupBy({
      by: ["campaignId"],
      where: { organizationId, campaignId: { not: null }, status: { in: [...REAL_MEETING_STATUSES] }, createdAt: range },
      _count: { campaignId: true },
    }),
    // Structural enrollment mapping, all-time — see the doc comment above for
    // why this is never date-filtered (only the Deal's own createdAt is).
    prisma.campaignContact.findMany({
      where: { campaign: { organizationId } },
      select: { campaignId: true, contact: { select: { companyId: true } } },
    }),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: "Won" }, createdAt: range, companyId: { not: null } },
      select: { companyId: true, value: true },
    }),
  ]);

  const contactsEnrolledByCampaign = new Map(contactsEnrolledGroups.map((g) => [g.campaignId, g._count.campaignId]));

  const emailsSentByCampaign = new Map<string, number>();
  for (const g of emailsSentGroups) {
    if (g.campaignId === null) continue;
    emailsSentByCampaign.set(g.campaignId, g._count.campaignId);
  }

  const repliesByCampaign = new Map<string, number>();
  for (const g of repliesGroups) {
    if (g.campaignId === null) continue;
    repliesByCampaign.set(g.campaignId, g._count.campaignId);
  }

  const meetingsByCampaign = new Map<string, number>();
  for (const g of meetingsGroups) {
    if (g.campaignId === null) continue;
    meetingsByCampaign.set(g.campaignId, g._count.campaignId);
  }

  const dealsByCompany = new Map<string, { count: number; revenue: number }>();
  for (const deal of dealRows) {
    if (!deal.companyId) continue;
    const current = dealsByCompany.get(deal.companyId) ?? { count: 0, revenue: 0 };
    current.count += 1;
    current.revenue += deal.value ?? 0;
    dealsByCompany.set(deal.companyId, current);
  }

  const companiesByCampaign = new Map<string, Set<string>>();
  for (const row of campaignContactRows) {
    const companyId = row.contact.companyId;
    if (!companyId) continue;
    const set = companiesByCampaign.get(row.campaignId) ?? new Set<string>();
    set.add(companyId);
    companiesByCampaign.set(row.campaignId, set);
  }

  return campaigns.map((c) => {
    const companies = companiesByCampaign.get(c.id) ?? new Set<string>();
    let wonDeals = 0;
    let revenue = 0;
    for (const companyId of companies) {
      const agg = dealsByCompany.get(companyId);
      if (!agg) continue;
      wonDeals += agg.count;
      revenue += agg.revenue;
    }
    return {
      campaignId: c.id,
      campaignName: c.name,
      contactsEnrolled: contactsEnrolledByCampaign.get(c.id) ?? 0,
      emailsSent: emailsSentByCampaign.get(c.id) ?? 0,
      replies: repliesByCampaign.get(c.id) ?? 0,
      meetings: meetingsByCampaign.get(c.id) ?? 0,
      wonDeals,
      revenue,
    };
  });
}
