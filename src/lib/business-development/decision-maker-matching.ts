/**
 * Decision Maker Matching (Phase 3) — a PURE function (no AI call, no DB)
 * that picks the single best "TARGET CONTACT" for an opportunity out of a
 * company's already-discovered `DecisionMaker` records. Deliberately mirrors
 * `opportunity-brief.ts`'s "read-time composer over already-persisted AI
 * output" discipline: nothing here is itself an AI call or a guess — it's a
 * transparent, documented scoring table over real rows.
 *
 * ROLE-RELEVANCE TABLE — which of the 11 target roles are the best person to
 * talk to for each KVL service (see kvl-service-catalog.ts for the full
 * service list/descriptions). Ordered by relevance; the first role listed is
 * the single best fit, the second/third are reasonable alternates. Adjusted
 * with real judgment against what each service actually is:
 *
 * - WEBSITE_DEVELOPMENT / SEO: a marketing-site rebuild/SEO play is a
 *   marketing-and-brand decision at a small/mid company — the Founder (who
 *   usually still owns brand/marketing decisions early on), the Marketing
 *   Head, or a Co-Founder.
 * - ECOMMERCE_DEVELOPMENT: a revenue-generating storefront touches both
 *   overall business strategy (Founder) and go-to-market (Marketing Head,
 *   Sales Head).
 * - SAAS_DEVELOPMENT / CUSTOM_SOFTWARE_DEVELOPMENT: building actual software
 *   product is squarely a technical-leadership decision — CTO first, Founder
 *   (often the technical co-founder at smaller companies) second, Product
 *   Head third.
 * - MOBILE_APP_DEVELOPMENT: same technical-build shape as SaaS, but the
 *   Product Head's product-scope ownership is weighted slightly closer to
 *   the CTO than for backend/SaaS work.
 * - CRM: an operations + sales-process tool — COO (owns the process), Sales
 *   Head (lives in it daily), Business Development Head.
 * - ERP: broader back-office/operations scope than CRM — COO, IT Head (owns
 *   the systems it'll integrate with), Director (a catch-all senior
 *   operations title at companies without a formal COO).
 * - AI_SOLUTIONS / AI_AUTOMATION: technical + operational — CTO (owns the
 *   technical feasibility), COO (owns which process gets automated),
 *   Founder (small companies often make this call directly).
 * - WHATSAPP_AUTOMATION / BUSINESS_AUTOMATION: day-to-day operational
 *   workflow automation — COO, Sales Head (WhatsApp automation is very
 *   often a sales/lead-response tool), IT Head.
 *
 * Any role not in a service's top-3 still gets a small non-zero "not
 * listed" weight (10) rather than 0 — an unmapped decision-maker is a weak
 * candidate, not a disqualified one; the CEO in particular is a sensible
 * generalist fallback for a company too small to have specialized titles.
 */

const ROLE_RELEVANCE_TABLE: Record<string, [string, string, string]> = {
  WEBSITE_DEVELOPMENT: ["FOUNDER", "MARKETING_HEAD", "CO_FOUNDER"],
  SEO: ["FOUNDER", "MARKETING_HEAD", "CO_FOUNDER"],
  ECOMMERCE_DEVELOPMENT: ["FOUNDER", "MARKETING_HEAD", "SALES_HEAD"],
  SAAS_DEVELOPMENT: ["CTO", "FOUNDER", "PRODUCT_HEAD"],
  CUSTOM_SOFTWARE_DEVELOPMENT: ["CTO", "FOUNDER", "PRODUCT_HEAD"],
  MOBILE_APP_DEVELOPMENT: ["CTO", "PRODUCT_HEAD", "FOUNDER"],
  CRM: ["COO", "SALES_HEAD", "BUSINESS_DEVELOPMENT_HEAD"],
  ERP: ["COO", "IT_HEAD", "DIRECTOR"],
  AI_SOLUTIONS: ["CTO", "COO", "FOUNDER"],
  AI_AUTOMATION: ["CTO", "COO", "FOUNDER"],
  WHATSAPP_AUTOMATION: ["COO", "SALES_HEAD", "IT_HEAD"],
  BUSINESS_AUTOMATION: ["COO", "SALES_HEAD", "IT_HEAD"],
};

/** Tier score for a role's position in a service's relevance table: 1st=100, 2nd=70, 3rd=40, not listed=10. */
const TIER_SCORES = [100, 70, 40] as const;
const NOT_LISTED_SCORE = 10;

/** Role-relevance score (0-100) for `role` against `recommendedService`. Unknown/unmapped services fall back to the NOT_LISTED_SCORE for every role — no service-specific signal to use. */
function roleRelevanceScore(recommendedService: string | null, role: string): number {
  if (!recommendedService) return NOT_LISTED_SCORE;
  const tiers = ROLE_RELEVANCE_TABLE[recommendedService];
  if (!tiers) return NOT_LISTED_SCORE;
  const index = tiers.indexOf(role);
  if (index === -1) return NOT_LISTED_SCORE;
  return TIER_SCORES[index];
}

/** Human-readable label for a service id, for use in `whyThisPerson`. Falls back to a title-cased rendering of the raw id for anything not in this small lookup. */
function serviceLabel(serviceId: string): string {
  const labels: Record<string, string> = {
    WEBSITE_DEVELOPMENT: "Website Development",
    ECOMMERCE_DEVELOPMENT: "E-commerce Development",
    SAAS_DEVELOPMENT: "SaaS Development",
    CUSTOM_SOFTWARE_DEVELOPMENT: "Custom Software Development",
    MOBILE_APP_DEVELOPMENT: "Mobile App Development",
    CRM: "CRM",
    ERP: "ERP",
    AI_SOLUTIONS: "AI Solutions",
    AI_AUTOMATION: "AI Automation",
    WHATSAPP_AUTOMATION: "WhatsApp Automation",
    BUSINESS_AUTOMATION: "Business Automation",
    SEO: "SEO",
  };
  return labels[serviceId] ?? serviceId.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function roleLabel(role: string): string {
  return role.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DecisionMakerCandidate {
  id: string;
  name: string;
  role: string;
  source: string;
  sourceUrl: string | null;
  confidence: number;
}

export interface DecisionMakerMatch {
  decisionMaker: { id: string; name: string; role: string; source: string; sourceUrl: string | null; confidence: number };
  relevanceScore: number; // 0-100
  whyThisPerson: string; // short, transparent explanation
}

/**
 * Picks the single highest-scoring `DecisionMaker` for a given
 * `recommendedService`. Score = a simple, documented average of (a)
 * role-relevance (0/10/40/70/100 per the tier table above) and (b) the
 * decision-maker's own real-identity `confidence` (0-1, scaled to 0-100) —
 * an even 50/50 weighting, since neither signal alone is trustworthy: a
 * perfectly-matched role with a shaky identity is just as weak a contact as
 * a rock-solid identity in an irrelevant role. Returns `null` when there are
 * no candidates at all.
 */
export function matchDecisionMakerForOpportunity(
  recommendedService: string | null,
  decisionMakers: DecisionMakerCandidate[],
): DecisionMakerMatch | null {
  if (decisionMakers.length === 0) return null;

  let best: { candidate: DecisionMakerCandidate; relevance: number; score: number } | null = null;

  for (const candidate of decisionMakers) {
    const relevance = roleRelevanceScore(recommendedService, candidate.role);
    const identityConfidence = Math.min(1, Math.max(0, candidate.confidence)) * 100;
    const score = (relevance + identityConfidence) / 2;

    if (!best || score > best.score) {
      best = { candidate, relevance, score };
    }
  }

  if (!best) return null;

  const { candidate, score } = best;
  const confidencePct = Math.round(Math.min(1, Math.max(0, candidate.confidence)) * 100);
  const tierRank = recommendedService ? ROLE_RELEVANCE_TABLE[recommendedService]?.indexOf(candidate.role) ?? -1 : -1;

  const whyThisPerson =
    tierRank === -1
      ? `${roleLabel(candidate.role)} was the strongest publicly-verified contact available (verified with ${confidencePct}% confidence via ${candidate.source})${
          recommendedService ? `, though not a specifically prioritized role for ${serviceLabel(recommendedService)} opportunities.` : "."
        }`
      : `${roleLabel(candidate.role)} is the ${tierRank === 0 ? "top-priority" : tierRank === 1 ? "second-priority" : "third-priority"} role for ${serviceLabel(
          recommendedService as string,
        )} opportunities, and this person was verified with ${confidencePct}% confidence via ${candidate.source}.`;

  return {
    decisionMaker: {
      id: candidate.id,
      name: candidate.name,
      role: candidate.role,
      source: candidate.source,
      sourceUrl: candidate.sourceUrl,
      confidence: candidate.confidence,
    },
    relevanceScore: Math.round(score),
    whyThisPerson,
  };
}

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — the ONE case-insensitive
 * full-name match between a Contact and a company's DecisionMaker rows,
 * shared by `enrichContact` (enrichment.ts, to set the real
 * `Contact.decisionMakerId` FK) and `buildContactContext`
 * (outreach/personalization.ts, as a fallback when that FK isn't set yet).
 * Previously this exact one-line match was duplicated inline only in
 * personalization.ts — centralizing it here means both callers can never
 * silently drift apart. Still just a name match (the real fix — a hard FK —
 * is what `Contact.decisionMakerId` now provides once this has run once);
 * this function is only the bridge that populates that FK in the first
 * place.
 */
export function findMatchingDecisionMaker<T extends { name: string }>(contactFullName: string, decisionMakers: T[]): T | null {
  const key = contactFullName.trim().toLowerCase();
  if (!key) return null;
  return decisionMakers.find((dm) => dm.name.trim().toLowerCase() === key) ?? null;
}
