import { prisma } from "@/lib/prisma";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";
import type { DecisionMakerRole } from "@/generated/prisma/client";

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

/**
 * Human-readable label for each `DecisionMakerRole` (e.g. "MARKETING_HEAD"
 * -> "Marketing Head", "CTO" -> "CTO" — a naive lowercase-then-title-case
 * transform would mangle the acronym roles into "Cto"/"Coo"/"Ceo").
 * Deliberately NOT imported from
 * `src/app/dashboard/opportunities/_lib/opportunity-display.ts`'s
 * `DECISION_MAKER_ROLE_LABEL` (a `src/lib` module shouldn't reach into
 * `src/app`) — a small local exhaustive `Record` duplicated instead, same
 * "small humanizer duplicated per call site" convention `decision-maker-
 * matching.ts` already uses for its own private `roleLabel`.
 */
const DECISION_MAKER_ROLE_LABEL: Record<DecisionMakerRole, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  DIRECTOR: "Director",
  CTO: "CTO",
  COO: "COO",
  MARKETING_HEAD: "Marketing Head",
  SALES_HEAD: "Sales Head",
  BUSINESS_DEVELOPMENT_HEAD: "Business Development Head",
  IT_HEAD: "IT Head",
  PRODUCT_HEAD: "Product Head",
};

/**
 * Real-data-only grounding summary for AI email/LinkedIn generation — mirrors
 * src/lib/scanner/ai-report-generator.ts's buildScanSummary style exactly.
 * Every section either reports a real stored fact or honestly says "not
 * available yet" — never invents a pain point, tech detail, or company fact
 * that hasn't actually been researched.
 *
 * Phase 5 extension: also grounds the draft in Phase 1-4 data when the
 * contact's company has it — real `CompanyEvidence` RAW_FACT rows, the
 * company's best/most relevant `LeadOpportunity` (highest `priority`/
 * `opportunityScore`, excluding DISMISSED — there's no way to thread an
 * explicit opportunityId through here without changing this function's
 * signature, which callers depend on staying `(contactId) => Promise<string>`,
 * so "most relevant" is derived from the company's own opportunity data
 * rather than passed in), `LeadScore`, `IntentScore`, and — when this
 * `Contact` name-matches a `DecisionMaker` at the same company (the same
 * indirect linkage `resolveOutreachContact` in
 * `decision-maker-outreach.ts` uses, since `Contact` has no direct FK to
 * `DecisionMaker`) — their verified role/source. Every new section follows
 * the exact same discipline as the sections above: a real stored fact, or an
 * honest "not available yet" line — a company with none of this Phase 1-4
 * data yet degrades to exactly the pre-Phase-5 context string.
 */
export async function buildContactContext(contactId: string): Promise<string> {
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: contactId },
    include: {
      company: {
        include: {
          intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          websiteScans: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { opportunity: true },
          },
          evidence: { where: { kind: "RAW_FACT" }, orderBy: { discoveredAt: "desc" }, take: 5 },
          leadOpportunities: {
            where: { status: { not: "DISMISSED" } },
            orderBy: [{ priority: "asc" }, { opportunityScore: "desc" }, { createdAt: "desc" }],
            take: 1,
          },
          leadScore: true,
          intentScore: true,
          decisionMakers: true,
        },
      },
    },
  });

  const sections = [
    `Contact: ${contact.firstName} ${contact.lastName ?? ""}`.trim() + (contact.jobTitle ? `, ${contact.jobTitle}` : ""),
    contact.company ? `Company: ${contact.company.name}` : "Company: not linked to a known company yet.",
    contact.company?.industry ? `Industry: ${contact.company.industry}` : null,
    contact.company?.headquartersCity || contact.company?.headquartersCountry
      ? `Location: ${[contact.company?.headquartersCity, contact.company?.headquartersCountry].filter(Boolean).join(", ")}`
      : contact.country || contact.city
        ? `Location: ${[contact.city, contact.country].filter(Boolean).join(", ")}`
        : null,
    contact.company?.technologies && contact.company.technologies.length > 0
      ? `Known technology stack: ${contact.company.technologies.join(", ")}`
      : "Technology stack: not researched yet.",
  ];

  const intel = contact.company?.intelligenceRuns[0];
  if (intel) {
    sections.push(`Business summary (from AI Company Intelligence): ${intel.businessSummary}`);
    if (intel.potentialPainPoints.length > 0) sections.push(`Real researched pain points: ${intel.potentialPainPoints.join("; ")}`);
    if (intel.businessOpportunities.length > 0) sections.push(`Real researched business opportunities: ${intel.businessOpportunities.join("; ")}`);
  } else {
    sections.push("No AI Company Intelligence report exists yet for this company — no researched pain points available.");
  }

  const scan = contact.company?.websiteScans[0];
  if (scan?.opportunity) {
    sections.push(
      `Website Opportunity score: ${scan.opportunity.overallOpportunityScore}/100 (${scan.opportunity.band}). Digital maturity ${scan.opportunity.digitalScore}, automation opportunity ${scan.opportunity.automationScore}.`,
    );
  } else {
    sections.push("No Website Scanner report exists yet for this company — no opportunity score available.");
  }

  // Phase 5: Real verified CompanyEvidence facts (RAW_FACT only — never an
  // AI_INTERPRETATION row, which is an inference, not an observed fact).
  const evidence = contact.company?.evidence ?? [];
  if (evidence.length > 0) {
    sections.push(`Real verified facts:\n${evidence.map((e) => `- ${e.fact}`).join("\n")}`);
  } else {
    sections.push("No real verified facts (CompanyEvidence) recorded yet for this company.");
  }

  // Phase 5: the company's best/most relevant open LeadOpportunity (see this
  // function's doc comment above for how "most relevant" is derived).
  const opportunity = contact.company?.leadOpportunities[0];
  if (opportunity) {
    const service = opportunity.recommendedService ? KVL_SERVICE_BY_ID.get(opportunity.recommendedService as KVLServiceId) : null;
    const opportunityLines = [
      `Detected opportunity: ${opportunity.title}`,
      `Description: ${opportunity.description}`,
      `Evidence: ${opportunity.evidence}`,
      service ? `Recommended service: ${service.label}` : null,
      opportunity.salesAngle ? `Sales angle: ${opportunity.salesAngle}` : null,
      opportunity.nextStep ? `Suggested next step: ${opportunity.nextStep}` : null,
    ].filter(Boolean);
    sections.push(opportunityLines.join("\n"));
  } else {
    sections.push("No detected LeadOpportunity exists yet for this company.");
  }

  // Phase 5: LeadScore (relevance/fit) — separate from IntentScore below.
  const leadScore = contact.company?.leadScore;
  if (leadScore) {
    sections.push(`Lead relevance: ${leadScore.overallScore}/100 (${leadScore.band}).`);
  } else {
    sections.push("No Lead Score computed yet for this company.");
  }

  // Phase 5: IntentScore (buying-intent signals).
  const intentScore = contact.company?.intentScore;
  if (intentScore) {
    sections.push(`Buying intent signals: ${intentScore.band} (${intentScore.reasoning})`);
  } else {
    sections.push("No buying-intent signals scored yet for this company.");
  }

  // Phase 5: if this Contact name-matches a real Phase 3 DecisionMaker at
  // the same company, surface their verified role/source. `Contact` has no
  // direct FK to `DecisionMaker` (Phase 3 deliberately has no email field,
  // see decision-maker-outreach.ts) — case-insensitive full-name matching is
  // the actual current traceability mechanism, same as
  // `resolveOutreachContact`'s dedup check.
  const fullNameKey = `${contact.firstName} ${contact.lastName ?? ""}`.trim().toLowerCase();
  const decisionMaker = contact.company?.decisionMakers.find((dm) => dm.name.trim().toLowerCase() === fullNameKey);
  if (decisionMaker) {
    sections.push(
      `This contact is the company's ${DECISION_MAKER_ROLE_LABEL[decisionMaker.role] ?? decisionMaker.role}, identified via ${decisionMaker.source}.`,
    );
  }

  return sections.filter(Boolean).join("\n");
}
