import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { runDigitalAudit, summarizeWebsiteScan } from "@/lib/company-discovery/digital-audit";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";

/**
 * Opportunity Engine (spec) — structured, categorized opportunities per
 * discovered Company: "Website Redesign / Custom Software / ERP / CRM / AI
 * Automation / Cloud Migration / Cyber Security / DevOps / Performance /
 * SEO / Digital Transformation" etc. Grounded ONLY in the company's real
 * `CompanyIntelligence` row (already-existing web-search research) plus a
 * real `WebsiteScan` against the company's own site — the exact same
 * scanner engine the AI Company Understanding Engine (Phase 16) uses for the
 * platform tenant's own site, reused here for a lead's site instead. Returns
 * without writing anything if no CompanyIntelligence exists yet — opportunities
 * are never invented from nothing.
 */

// Built from the real catalog (kvl-service-catalog.ts) so an
// invalid/hallucinated service id fails Zod validation rather than being
// silently accepted.
const KVL_SERVICE_IDS = KVL_SERVICES.map((s) => s.id) as [KVLServiceId, ...KVLServiceId[]];

const LeadOpportunitySchema = z.object({
  category: z.string(),
  title: z.string(),
  description: z.string(),
  estimatedImpact: z.enum(["low", "medium", "high"]),
  estimatedValue: z.number().nonnegative().nullable(),
  evidence: z.string(),
  confidenceScore: z.number().min(0).max(100),
  // KVL service catalog matching — grounded in the same evidence already
  // required above for the opportunity itself.
  recommendedService: z.enum(KVL_SERVICE_IDS),
  serviceMatchScore: z.number().min(0).max(100),
  serviceMatchReason: z.string(),
  // AI Opportunity Brief — the sales-facing hook and concrete next action,
  // both grounded in the same evidence as the opportunity itself.
  salesAngle: z.string(),
  nextStep: z.string(),
});

const LeadOpportunitiesSchema = z.object({
  opportunities: z.array(LeadOpportunitySchema).max(8).default([]),
});

export async function generateLeadOpportunities(companyId: string): Promise<number> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const intelligence = await prisma.companyIntelligence.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } });
  if (!intelligence) return 0; // opportunities require real intelligence data — never fabricate from nothing

  let auditSummary: { text: string; techFindings: string[] } | null = null;
  if (company.website) {
    const existingScan = await prisma.websiteScan.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } });
    if (existingScan) {
      auditSummary = await summarizeWebsiteScan(existingScan.id);
    } else {
      const owner = await prisma.membership.findFirst({
        where: { organizationId: company.organizationId, status: "ACTIVE", role: "OWNER" },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      if (owner) {
        try {
          const audit = await runDigitalAudit({
            organizationId: company.organizationId,
            ownerUserId: owner.userId,
            websiteUrl: company.website,
            companyId,
          });
          if (audit.ok) auditSummary = await summarizeWebsiteScan(audit.websiteScanId);
        } catch (error) {
          console.error(`[business-development/opportunity-engine] website scan failed for company ${companyId}:`, error);
        }
      }
    }
  }

  const result = await generateStructured({
    system: [
      "You are a B2B growth consultant. Identify concrete business opportunities for selling to this company",
      "(examples: Website Redesign, Custom Software, ERP, CRM, AI Automation, Cloud Migration, Cyber Security,",
      "DevOps, Performance Improvements, SEO Improvements, Digital Transformation) — but ONLY where genuinely",
      "supported by the real research/audit data given below. Every opportunity needs a real evidence citation",
      "from that data. Never invent a generic opportunity with no basis in what was actually found.",
      "",
      "For every opportunity you also must recommend exactly one service from KVL's real service catalog below",
      "— set recommendedService to that service's id verbatim. Pick the single best-fitting service (use the",
      "descriptions to disambiguate overlapping services, e.g. CRM vs BUSINESS_AUTOMATION vs AI_AUTOMATION).",
      "Give serviceMatchScore (0-100, how strong the fit is) and serviceMatchReason (a short explanation grounded",
      "in the same evidence as the opportunity itself — why this specific service, not another catalog entry).",
      "",
      "KVL service catalog:",
      KVL_SERVICES.map((s) => `- ${s.id} (${s.label}): ${s.description}`).join("\n"),
      "",
      "For every opportunity you also must give salesAngle and nextStep, both grounded in the SAME evidence you",
      "cited for the opportunity — never generic boilerplate like 'reach out and introduce our services'.",
      "salesAngle is a short, concrete conversation opener/hook a salesperson could actually use, referencing the",
      "specific detected problem (e.g. \"Their checkout has no visible payment-security badges — lead with the",
      "trust/conversion angle, not price.\"). nextStep is a short, concrete recommended action grounded in the same",
      "evidence (e.g. \"Offer a free 15-minute site audit call\" or \"Send the portfolio PDF referencing 2 similar",
      "e-commerce clients\"). If you cannot ground either in real evidence, do not invent a generic one — make it",
      "as specific as the underlying evidence allows.",
    ].join(" "),
    userContent: JSON.stringify({
      businessSummary: intelligence.businessSummary,
      techStackSummary: intelligence.techStackSummary,
      digitalPresenceSummary: intelligence.digitalPresenceSummary,
      seoOverview: intelligence.seoOverview,
      performanceOverview: intelligence.performanceOverview,
      businessOpportunities: intelligence.businessOpportunities,
      estimatedSoftwareNeeds: intelligence.estimatedSoftwareNeeds,
      potentialPainPoints: intelligence.potentialPainPoints,
      digitalAudit: auditSummary,
    }),
    maxTokens: 2560,
    effort: "medium",
    schema: LeadOpportunitiesSchema,
  });

  await recordAIUsage(
    company.organizationId,
    result.provider,
    result.model,
    result.inputTokens,
    result.outputTokens,
    "business-development:lead-opportunities",
  );

  if (result.parsed.opportunities.length === 0) return 0;

  await prisma.leadOpportunity.createMany({
    data: result.parsed.opportunities.map((o) => ({
      companyId,
      category: o.category,
      title: o.title,
      description: o.description,
      estimatedImpact: o.estimatedImpact,
      estimatedValue: o.estimatedValue,
      evidence: o.evidence,
      confidenceScore: o.confidenceScore,
      recommendedService: o.recommendedService,
      serviceMatchScore: o.serviceMatchScore,
      serviceMatchReason: o.serviceMatchReason,
      salesAngle: o.salesAngle,
      nextStep: o.nextStep,
      generatedByAgentId: intelligence.generatedByAgentId,
    })),
  });

  return result.parsed.opportunities.length;
}
