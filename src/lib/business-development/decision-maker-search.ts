import type { DecisionMakerRole, Prisma } from "@/generated/prisma/client";

/**
 * Phase 15 (Advanced B2B Data & Prospecting Engine) — real, server-side
 * filter-building for the new standalone Decision-Maker search
 * (/dashboard/company-discovery/decision-makers). Extracted as a pure
 * function for the same reason as buildCompanyDiscoveryWhere.
 *
 * DecisionMaker has no separate "seniority"/"department" field — `role`
 * (an enum of real executive-level titles: CEO, CTO, FOUNDER, etc.) is the
 * closest real, non-fabricated proxy the schema supports today. This does
 * not invent a seniority/department taxonomy on top of it.
 */
export interface DecisionMakerSearchInput {
  name?: string;
  roles?: DecisionMakerRole[];
  industries?: string[];
  countries?: string[];
  minConfidence?: number;
}

export function buildDecisionMakerSearchWhere(
  organizationId: string,
  input: DecisionMakerSearchInput,
): Prisma.DecisionMakerWhereInput {
  const conditions: Prisma.DecisionMakerWhereInput[] = [{ company: { organizationId } }];

  if (input.name) conditions.push({ name: { contains: input.name, mode: "insensitive" } });
  if (input.roles && input.roles.length > 0) conditions.push({ role: { in: input.roles } });
  if (input.industries && input.industries.length > 0) conditions.push({ company: { industry: { in: input.industries } } });
  if (input.countries && input.countries.length > 0) conditions.push({ company: { headquartersCountry: { in: input.countries } } });
  if (input.minConfidence !== undefined) conditions.push({ confidence: { gte: input.minConfidence } });

  return { AND: conditions };
}
