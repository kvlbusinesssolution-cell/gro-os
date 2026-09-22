import type { ContactBuyerRole, Prisma } from "@/generated/prisma/client";

/**
 * Phase 25 (ICP filtering) — real, server-side filter-building for
 * Contact search, same pure/testable "headless core" discipline as
 * `buildCompanyDiscoveryWhere` (Phase 15/23) and
 * `buildDecisionMakerSearchWhere` (Phase 15). Every field filtered here
 * already exists on the real Contact model (jobTitle, department,
 * seniority [Phase 25], country/city, buyerRole [Phase 25]) — this only
 * surfaces them as real query filters, no new data is invented.
 */
export interface ContactSearchFilterInput {
  jobTitle?: string;
  department?: string;
  seniority?: string;
  country?: string;
  city?: string;
  buyerRole?: ContactBuyerRole;
  companyId?: string;
}

export function buildContactSearchWhere(organizationId: string, input: ContactSearchFilterInput): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {
    organizationId,
    // A merged-away contact must never appear in a real search result —
    // it's reachable only via its keeper's `mergedFrom` relation.
    mergedIntoId: null,
  };

  if (input.jobTitle?.trim()) where.jobTitle = { contains: input.jobTitle.trim(), mode: "insensitive" };
  if (input.department?.trim()) where.department = { contains: input.department.trim(), mode: "insensitive" };
  if (input.seniority?.trim()) where.seniority = { contains: input.seniority.trim(), mode: "insensitive" };
  if (input.country?.trim()) where.country = { equals: input.country.trim(), mode: "insensitive" };
  if (input.city?.trim()) where.city = { equals: input.city.trim(), mode: "insensitive" };
  if (input.buyerRole) where.buyerRole = input.buyerRole;
  if (input.companyId) where.companyId = input.companyId;

  return where;
}
