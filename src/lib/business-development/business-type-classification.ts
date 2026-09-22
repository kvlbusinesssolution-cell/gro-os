import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { fetchFieldWithWaterfall } from "@/lib/ai/field-waterfall";
import { resolveFieldConflict } from "./evidence-priority";

/**
 * Phase 27 real proof-of-integration for the field-waterfall framework, and
 * a genuine fix for a real gap Phase 26's own audit flagged: `businessType`
 * (schema.prisma) has always been a free-form string with zero real
 * classification logic anywhere. Real, deterministic taxonomy — not an
 * open-ended free-text guess — so the result is genuinely queryable/
 * filterable, matching this codebase's "never a plausible-sounding but
 * un-auditable AI answer" discipline.
 */
export const BUSINESS_TYPE_VALUES = ["B2B", "B2C", "B2B2C", "MARKETPLACE", "SAAS", "SERVICES", "UNKNOWN"] as const;
export type BusinessTypeValue = (typeof BUSINESS_TYPE_VALUES)[number];

const BusinessTypeSchema = z.object({
  businessType: z.enum(BUSINESS_TYPE_VALUES),
  /** Real, brief grounding for the classification — not stored, just lets the schema force the model to reason rather than guess blindly. */
  reasoning: z.string().trim().min(1),
});

/** Stage 1 is "complete" only when the model didn't just default to UNKNOWN — a real signal it found something concrete to classify from, not merely that the JSON parsed. */
function isComplete(value: z.infer<typeof BusinessTypeSchema>): boolean {
  return value.businessType !== "UNKNOWN";
}

const SYSTEM_PROMPT = [
  "You classify a company's real business model into exactly one of: B2B, B2C, B2B2C, MARKETPLACE, SAAS, SERVICES, UNKNOWN.",
  "Base this ONLY on concrete, real information given to you (company name, website, description, products/services).",
  "If the information given is too thin to classify confidently, return UNKNOWN — never guess from the company name alone.",
].join(" ");

export interface ClassifyBusinessTypeResult {
  businessType: BusinessTypeValue | null;
  applied: boolean;
  usedRealWebSearch: boolean;
}

/**
 * Classifies `Company.businessType` via the real 2-stage waterfall (stage 1:
 * structured extraction from already-known company data; stage 2, only if
 * stage 1 came back UNKNOWN: real web-search research). Writes through
 * evidence-priority.ts's real conflict resolution (same pattern Phase 26
 * wired into technology-evidence-sync.ts) — a MANUAL correction on file
 * always outranks this automated classification.
 */
export async function classifyBusinessType(companyId: string): Promise<ClassifyBusinessTypeResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const knownFacts = [
    `Company name: ${company.name}`,
    company.website ? `Website: ${company.website}` : null,
    company.industry ? `Industry: ${company.industry}` : null,
    company.servicesOffered.length > 0 ? `Services offered: ${company.servicesOffered.join(", ")}` : null,
    company.products.length > 0 ? `Products: ${company.products.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (!knownFacts) {
    return { businessType: null, applied: false, usedRealWebSearch: false };
  }

  const result = await fetchFieldWithWaterfall({
    schema: BusinessTypeSchema,
    system: SYSTEM_PROMPT,
    userContent: `Classify this real company's business model:\n${knownFacts}`,
    researchUserContent: `Research this real company and classify its business model. Only use what you actually find published — never guess from the name alone.\n${knownFacts}`,
    maxTokens: 512,
    effort: "low",
    isComplete,
    usage: { organizationId: company.organizationId, context: "business-development:business-type-classification" },
  });

  if (result.value.businessType === "UNKNOWN") {
    return { businessType: "UNKNOWN", applied: false, usedRealWebSearch: result.usedRealWebSearch };
  }

  const source = result.finalSource === "WEB_SEARCH_RESEARCH" ? "WEB_SEARCH" : "COMPANY_INTELLIGENCE";
  const existingFieldEvidence = await prisma.companyEvidence.findMany({
    where: { companyId, fieldName: "businessType" },
    select: { source: true },
  });
  const conflict = resolveFieldConflict(source, existingFieldEvidence);

  await prisma.companyEvidence.create({
    data: {
      companyId,
      kind: "AI_INTERPRETATION",
      fact: `Classified business model as ${result.value.businessType}: ${result.value.reasoning}`,
      source,
      fieldName: "businessType",
      confidence: result.finalSource === "WEB_SEARCH_RESEARCH" ? 0.7 : 0.5,
    },
  });

  if (conflict.shouldApplyToCompanyField) {
    await prisma.company.update({ where: { id: companyId }, data: { businessType: result.value.businessType } });
  }

  return { businessType: result.value.businessType, applied: conflict.shouldApplyToCompanyField, usedRealWebSearch: result.usedRealWebSearch };
}
