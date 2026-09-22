import { prisma } from "@/lib/prisma";

import { enrichCompany, type EnrichCompanyOptions, isStale, DEFAULT_STALE_DAYS, HIGH_VALUE_STALE_DAYS, isCompanyHighValue } from "./enrichment";
import { buildOpportunityBrief } from "./opportunity-brief";
import { getIntentRecommendedAction } from "./intent-recommendation";
import type { EnrichmentRun, EnrichmentTrigger } from "@/generated/prisma/client";

/**
 * Phase 3 (AI Company Research Engine) — a READ-TIME REPORT COMPOSER and a
 * thin research-run wrapper. Deliberately NOT a new data-gathering
 * pipeline: the spec's own diagram (Qualified Company -> Research Queue ->
 * Source Collection -> Source Validation -> Evidence Normalization -> AI
 * Analysis -> Confidence -> Research Report -> Intent/DecisionMaker/
 * Opportunity/Outreach Connection) is exactly what Phase 1's `enrichCompany`
 * (Company Intelligence -> Intent Score -> Decision Makers -> Opportunities
 * -> Lead Score, all step-tracked on a real `EnrichmentRun` row) plus Phase
 * 2's read-only intent/stage already do. "Research" here = "enrichment" +
 * a genuinely new presentation/synthesis layer over its output. No new AI
 * calls happen in this file except via the reused `enrichCompany`.
 *
 * Lifecycle reuse: the spec's requested QUEUED/RUNNING/PARTIAL/COMPLETED/
 * FAILED/STALE statuses are exactly `Company.enrichmentStatus`'s existing 6
 * values (Phase 1) — no second status enum was created. "Research run
 * history" reuses `EnrichmentRun` (extended this phase with `confidence`/
 * `aiProvider`, not replaced) rather than a new `CompanyResearchRun` model.
 */

export type ResearchOptions = EnrichCompanyOptions;

/** "Research Now" / "Refresh Research" — thin wrapper around the reused Phase 1 pipeline, then backfills this run's confidence/aiProvider honestly (never fabricated) from real rows produced during the run. */
export async function researchCompany(companyId: string, options: ResearchOptions): Promise<EnrichmentRun> {
  const { run } = await enrichCompany(companyId, options);
  // Already RUNNING (idempotency guard fired) — nothing new to backfill yet.
  if (run.status === "RUNNING" || run.status === "QUEUED") return run;

  const [intelligence, latestUsage] = await Promise.all([
    prisma.companyIntelligence.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } }),
    prisma.aIUsageEvent.findFirst({
      where: { organizationId: run.organizationId, createdAt: { gte: run.startedAt, lte: run.finishedAt ?? new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return prisma.enrichmentRun.update({
    where: { id: run.id },
    data: {
      confidence: intelligence?.createdAt && intelligence.createdAt >= run.startedAt ? intelligence.confidenceScore : run.confidence,
      aiProvider: latestUsage?.provider ?? run.aiProvider,
    },
  });
}

/**
 * "Refresh Research" with the spec's explicit "do not refresh unnecessarily"
 * / "No Significant Change" rule — reuses Phase 1's `isStale()`/
 * `isCompanyHighValue()` (never a second freshness system) as the gate.
 */
export async function refreshResearchIfStale(companyId: string, options: ResearchOptions): Promise<{ refreshed: boolean; reason: string; run: EnrichmentRun | null }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const highValue = await isCompanyHighValue(companyId);
  const threshold = highValue ? HIGH_VALUE_STALE_DAYS : DEFAULT_STALE_DAYS;

  if (!isStale(company.lastEnrichedAt, threshold) && options.triggeredBy !== "MANUAL") {
    return { refreshed: false, reason: `No Significant Change — last researched within the last ${threshold} days.`, run: null };
  }

  const run = await researchCompany(companyId, options);
  return { refreshed: true, reason: "Research refreshed.", run };
}

// ===== Research Report composition =====

const BUSINESS_MODEL_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
  { label: "SaaS", keywords: ["saas", "software-as-a-service", "subscription software", "cloud platform"] },
  { label: "Marketplace", keywords: ["marketplace", "two-sided platform", "connects buyers and sellers"] },
  { label: "E-commerce", keywords: ["e-commerce", "online store", "online retail", "storefront"] },
  { label: "D2C", keywords: ["direct-to-consumer", "d2c", "direct to consumer"] },
  { label: "Subscription", keywords: ["subscription", "recurring revenue", "membership"] },
  { label: "B2B", keywords: ["b2b", "business-to-business", "enterprise customers"] },
  { label: "B2C", keywords: ["b2c", "business-to-consumer", "consumer app"] },
  { label: "Services", keywords: ["consulting", "professional services", "agency"] },
  { label: "Healthcare", keywords: ["healthcare", "clinic", "hospital", "health-tech", "healthtech"] },
  { label: "EdTech", keywords: ["edtech", "online education", "e-learning", "learning platform"] },
  { label: "FinTech", keywords: ["fintech", "payments platform", "lending", "neobank"] },
];

export interface BusinessModelObservation {
  label: string;
  classification: "OBSERVED" | "AI_INTERPRETATION";
  evidence: string;
}

/** Deterministic keyword match over real, already-persisted text (Company.businessType, CompanyIntelligence.businessSummary) — never a fresh AI call, never an invented confidence number. */
function classifyBusinessModel(businessType: string | null, businessSummary: string | null): BusinessModelObservation[] {
  const results: BusinessModelObservation[] = [];
  if (businessType) results.push({ label: businessType, classification: "OBSERVED", evidence: "Manually entered on the Company record." });

  const haystack = (businessSummary ?? "").toLowerCase();
  for (const { label, keywords } of BUSINESS_MODEL_KEYWORDS) {
    const matched = keywords.find((kw) => haystack.includes(kw));
    if (matched && !results.some((r) => r.label === label)) {
      results.push({ label, classification: "AI_INTERPRETATION", evidence: `Business summary mentions "${matched}".` });
    }
  }
  return results;
}

export type PainPointCategory = "CONFIRMED_PAIN_POINT" | "EVIDENCE_BASED_OPPORTUNITY" | "POSSIBLE_PAIN_POINT";

export interface PainPointView {
  category: PainPointCategory;
  detail: string;
  evidence: string | null;
}

const RECENT_CHANGE_LOOKBACK_DAYS = 90;

export interface RecentChangeView {
  what: string;
  when: string;
  source: string;
  confidence: "verified" | "ai_research";
}

export interface ResearchQualityBreakdown {
  evidenceCoverage: number;
  sourceQuality: number;
  freshness: number;
  completeness: number;
}

export interface CompanyResearchReport {
  status: string; // Company.enrichmentStatus
  lastResearchedAt: string | null;
  researchQuality: number; // 0-100, distinct from IntentScore — see §30
  researchQualityBreakdown: ResearchQualityBreakdown;

  overview: {
    name: string;
    website: string | null;
    domain: string | null;
    industry: string | null;
    location: string | null;
    companySize: string | null; // "UNKNOWN" if employeeCount is null
    foundedYear: number | null;
  };
  businessModel: BusinessModelObservation[];
  products: { products: string[]; services: string[]; productsSummary: string | null; servicesSummary: string | null };
  technology: { confirmed: string[]; note: string };
  growthSignals: string[];
  hiringSignals: string[];
  leadership: Array<{ name: string; role: string; source: string; confidence: number }>;
  expansionSignals: string[];
  recentChanges: RecentChangeView[];
  painPoints: PainPointView[];
  evidenceCount: number;
  unknowns: string[];

  // Reused wholesale from Phase 2/opportunity-brief — never recomputed here.
  buyingIntent: { score: number; band: string; buyingStage: string; buyingStageReasoning: string } | null;
  kvlOpportunity: Awaited<ReturnType<typeof buildOpportunityBrief>>;
  decisionMaker: Awaited<ReturnType<typeof getIntentRecommendedAction>>["decisionMaker"];
  recommendedService: { id: string; label: string } | null;

  outreachAngle: { angle: string | null; supportingEvidence: string[] } | null;
  firstMessageContext: {
    openingObservation: string;
    relevantSignal: string;
    kvlRelevance: string;
    ctaDirection: string;
    label: "AI DRAFT / CONTEXT — not a sent message";
  } | null;
  whyNow: string;
}

/**
 * Pure read-time composition, zero new AI calls. Every field either has
 * real backing data (with its source labeled) or is explicit "UNKNOWN" —
 * the same discipline opportunity-brief.ts already established.
 */
export async function buildCompanyResearchReport(companyId: string): Promise<CompanyResearchReport | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      decisionMakers: true,
      evidence: { orderBy: { discoveredAt: "desc" } },
      intentScore: true,
      timelineEvents: { orderBy: { occurredAt: "desc" }, take: 20 },
    },
  });
  if (!company) return null;

  const intelligence = company.intelligenceRuns[0] ?? null;

  const opportunity = await prisma.leadOpportunity.findFirst({
    where: { companyId, status: { not: "DISMISSED" } },
    orderBy: [{ priority: "asc" }, { opportunityScore: "desc" }, { createdAt: "desc" }],
  });
  const [kvlOpportunity, recommendation] = await Promise.all([
    opportunity ? buildOpportunityBrief(opportunity.id) : Promise.resolve(null),
    getIntentRecommendedAction(companyId),
  ]);

  // ===== Recent changes: reuse CompanyTimelineEvent (real, already written
  // by generateCompanyIntelligence for HIRING/EXPANSION — see that file) —
  // never a new event log, per §8 "do not duplicate the evidence pipeline".
  const recentChanges: RecentChangeView[] = company.timelineEvents
    .filter((e) => Date.now() - e.occurredAt.getTime() <= RECENT_CHANGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .filter((e) => ["FUNDING", "HIRING", "EXPANSION", "WEBSITE_UPDATE", "ANNOUNCEMENT"].includes(e.type))
    .map((e) => ({
      what: e.title,
      when: e.occurredAt.toISOString(),
      source: e.source === "AI_RESEARCH" ? "AI research pass" : e.source === "SYSTEM" ? "System-detected" : "Manually entered",
      confidence: e.source === "AI_RESEARCH" ? ("ai_research" as const) : ("verified" as const),
    }));

  // ===== Pain points: RAW_FACT evidence = evidence-backed; CompanyIntelligence's own list = possible-only (AI, no cited source row). =====
  const painPoints: PainPointView[] = [
    ...company.evidence
      .filter((e) => e.kind === "RAW_FACT")
      .filter((e) => /slow|error|missing|broken|no |not indexable|fail|poor|below|outdated/i.test(e.fact))
      .map((e) => ({ category: "EVIDENCE_BASED_OPPORTUNITY" as const, detail: e.fact, evidence: e.sourceUrl ?? e.source })),
    ...(intelligence?.potentialPainPoints ?? []).map((p) => ({ category: "POSSIBLE_PAIN_POINT" as const, detail: p, evidence: null })),
  ];

  const unknowns: string[] = [];
  if (!company.estimatedRevenue) unknowns.push("Revenue: UNKNOWN — not verified from any real source.");
  if (!company.employeeCount) unknowns.push("Employee count: UNKNOWN — not verified from any real source.");
  if (!company.fundingStage && !company.fundingAmount) unknowns.push("Funding: UNKNOWN — no real funding data on record.");
  if (company.decisionMakers.length === 0) unknowns.push("Decision maker: UNKNOWN — no real publicly-sourced individual identified yet.");
  if (company.technologies.length === 0) unknowns.push("Technology stack: UNKNOWN — no confirmed technology detected yet.");

  const researchQualityBreakdown: ResearchQualityBreakdown = {
    evidenceCoverage: clamp01to100(company.evidence.length * 10), // 10 pts/evidence row, capped
    sourceQuality: intelligence ? clamp01to100(intelligence.confidenceScore * 100) : 0,
    freshness: company.lastEnrichedAt && !isStale(company.lastEnrichedAt, DEFAULT_STALE_DAYS) ? 100 : company.lastEnrichedAt ? 40 : 0,
    completeness: clamp01to100(
      (5 - unknowns.length) * 20, // 5 checked facts above; each present = +20
    ),
  };
  const researchQuality = clamp01to100(
    researchQualityBreakdown.evidenceCoverage * 0.3 +
      researchQualityBreakdown.sourceQuality * 0.3 +
      researchQualityBreakdown.freshness * 0.2 +
      researchQualityBreakdown.completeness * 0.2,
  );

  const topSignals = (company.intentScore?.signals as unknown as Array<{ signal: string; detail: string }>) ?? [];
  const whyNowReasons = topSignals.slice(0, 3).map((s) => s.detail);
  const whyNow = whyNowReasons.length > 0 ? `${whyNowReasons.length} relevant signal(s) detected recently: ${whyNowReasons.join("; ")}.` : "No strong recent trigger identified.";

  const outreachAngle = opportunity
    ? { angle: opportunity.salesAngle ?? null, supportingEvidence: whyNowReasons }
    : null;

  const firstMessageContext =
    opportunity && kvlOpportunity
      ? {
          openingObservation: whyNowReasons[0] ?? "No specific recent signal to open with yet.",
          relevantSignal: whyNowReasons[1] ?? "No secondary signal identified.",
          kvlRelevance: kvlOpportunity.recommendedService ? `Potential fit: ${kvlOpportunity.recommendedService.label}.` : "No specific KVL service fit identified yet.",
          ctaDirection: opportunity.nextStep ?? "Suggest a short introductory call.",
          label: "AI DRAFT / CONTEXT — not a sent message" as const,
        }
      : null;

  return {
    status: company.enrichmentStatus,
    lastResearchedAt: company.lastEnrichedAt?.toISOString() ?? null,
    researchQuality,
    researchQualityBreakdown,
    overview: {
      name: company.name,
      website: company.website,
      domain: company.domain,
      industry: company.industry,
      location: [company.headquartersCity, company.headquartersCountry].filter(Boolean).join(", ") || null,
      companySize: company.employeeCount ? `${company.employeeCount} employees` : null,
      foundedYear: company.foundedYear,
    },
    businessModel: classifyBusinessModel(company.businessType, intelligence?.businessSummary ?? null),
    products: {
      products: company.products,
      services: company.servicesOffered,
      productsSummary: intelligence?.productsSummary ?? null,
      servicesSummary: intelligence?.servicesSummary ?? null,
    },
    technology: {
      confirmed: company.technologies,
      note: company.technologies.length > 0 ? "Confirmed via real website scan/company data." : "No confirmed technology on record.",
    },
    growthSignals: intelligence?.growthSignals ?? [],
    hiringSignals: intelligence?.hiringSignals ?? [],
    leadership: company.decisionMakers.map((dm) => ({ name: dm.name, role: dm.role, source: dm.source, confidence: dm.confidence })),
    expansionSignals: intelligence?.expansionIndicators ?? [],
    recentChanges,
    painPoints,
    evidenceCount: company.evidence.length,
    unknowns,
    buyingIntent: company.intentScore
      ? { score: company.intentScore.score, band: company.intentScore.band, buyingStage: company.intentScore.buyingStage, buyingStageReasoning: company.intentScore.buyingStageReasoning }
      : null,
    kvlOpportunity,
    decisionMaker: recommendation.decisionMaker,
    recommendedService: kvlOpportunity?.recommendedService ?? null,
    outreachAngle,
    firstMessageContext,
    whyNow,
  };
}

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type { EnrichmentTrigger };
