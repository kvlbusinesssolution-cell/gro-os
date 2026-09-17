import { prisma } from "@/lib/prisma";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";

/**
 * AI Opportunity Brief — a READ-TIME composer, not another AI call. Assembles
 * the brief's fields from the already-persisted `LeadOpportunity` row (Phase
 * 2's single `generateStructured()` call, see opportunity-engine.ts) plus the
 * linked `Company` and its most recent `CompanyIntelligence` row. Nothing
 * here is invented: fields with no real underlying data return an honest
 * fallback string or `null` rather than a fabricated one.
 */

export interface OpportunityBrief {
  companyOverview: string;
  detectedProblem: string;
  businessContext: string;
  evidence: string;
  recommendedService: { id: string; label: string } | null;
  whyThisService: string | null;
  confidence: number;
  serviceMatchScore: number | null;
  recommendedSalesAngle: string | null;
  recommendedNextStep: string | null;
}

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

export async function buildOpportunityBrief(opportunityId: string): Promise<OpportunityBrief | null> {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: true },
  });
  if (!opportunity) return null;

  const company = opportunity.company;
  const intelligence = await prisma.companyIntelligence.findFirst({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
  });

  const companyOverviewParts = [
    company.name,
    company.industry ?? null,
    [company.headquartersCity, company.headquartersCountry].filter(Boolean).join(", ") || null,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));
  const companyOverview = [companyOverviewParts.join(" — "), intelligence?.businessSummary ?? null]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(". ");

  const businessContext =
    intelligence?.digitalPresenceSummary && intelligence.digitalPresenceSummary.trim().length > 0
      ? intelligence.digitalPresenceSummary
      : buildFallbackBusinessContext(company);

  const recommendedService = opportunity.recommendedService
    ? recommendedServiceLookup(opportunity.recommendedService)
    : null;

  return {
    companyOverview: companyOverview.trim().length > 0 ? companyOverview : company.name,
    detectedProblem: opportunity.description,
    businessContext,
    evidence: opportunity.evidence,
    recommendedService,
    whyThisService: opportunity.serviceMatchReason ?? null,
    confidence: opportunity.confidenceScore,
    serviceMatchScore: opportunity.serviceMatchScore ?? null,
    recommendedSalesAngle: opportunity.salesAngle ?? null,
    recommendedNextStep: opportunity.nextStep ?? null,
  };
}

function recommendedServiceLookup(serviceId: string): { id: string; label: string } | null {
  const service = KVL_SERVICE_BY_ID.get(serviceId as KVLServiceId);
  if (!service) return null; // defensive: shouldn't happen given Zod validation at write time
  return { id: service.id, label: service.label };
}

function buildFallbackBusinessContext(company: {
  name: string;
  industry: string | null;
  website: string | null;
  employeeCount: number | null;
}): string {
  const knownFacts = [
    company.industry ? `operates in ${company.industry}` : null,
    company.website ? `has a website at ${company.website}` : null,
    company.employeeCount ? `has roughly ${company.employeeCount} employees` : null,
  ].filter((fact): fact is string => Boolean(fact));

  if (knownFacts.length === 0) return "No additional business context researched yet.";
  return `${company.name} ${knownFacts.join(", ")}. No additional business context researched yet.`;
}
