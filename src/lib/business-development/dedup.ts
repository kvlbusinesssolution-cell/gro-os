import { prisma } from "@/lib/prisma";
import type { Company, CompanySource, CompanyStatus, Contact } from "@/generated/prisma/client";

/**
 * Strips protocol/www/path down to a bare lowercase hostname — the real,
 * comparable identity of a website URL for dedup matching. Returns null for
 * anything that doesn't parse as a URL, so callers fall back to name matching.
 */
export function normalizeWebsiteHost(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export interface FindOrCreateCompanyInput {
  organizationId: string;
  name: string;
  website?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  source: CompanySource;
  status: CompanyStatus;
  // Only used for the name+country matching tier below — optional so every
  // existing caller that doesn't discover a country keeps its prior
  // name-only-fallback behavior unchanged.
  headquartersCountry?: string | null;
}

export interface FindOrCreateCompanyResult {
  company: Company;
  wasCreated: boolean;
}

/**
 * Increments the discovery-tracking fields on an already-matched Company:
 * `sourceCount` +1, `discoverySources` deduped-appended with `source`, and
 * `lastDiscoveredAt` bumped to now. Returns the freshly updated row.
 */
async function recordRediscovery(company: Company, source: CompanySource): Promise<Company> {
  const nextSources = company.discoverySources.includes(source)
    ? company.discoverySources
    : [...company.discoverySources, source];

  return prisma.company.update({
    where: { id: company.id },
    data: {
      sourceCount: { increment: 1 },
      discoverySources: nextSources,
      lastDiscoveredAt: new Date(),
    },
  });
}

/**
 * The single choke point every "a discovered company might already exist"
 * write path (manual Lead Finder/Client Finder saves, the autonomous
 * discovery job) goes through. Matches by normalized website hostname first
 * (the strongest real-world identity signal), then a case-insensitive
 * name match scoped to the same organization AND matching
 * `headquartersCountry` (only when a country is supplied), then falls back
 * to a plain case-insensitive exact name match within the same
 * organization. Neither website nor name matching existed anywhere before
 * this — every prior save path called `prisma.company.create()`
 * unconditionally, so re-running the same search (or Lead Finder and Client
 * Finder both finding the same company) created duplicate `Company` rows.
 *
 * Every time an existing company is matched (any tier), its discovery-source
 * tracking fields (`sourceCount`, `discoverySources`, `lastDiscoveredAt`) are
 * updated to reflect this re-discovery. A freshly created company has those
 * fields initialized to a first-discovery state.
 */
export async function findOrCreateCompany(input: FindOrCreateCompanyInput): Promise<FindOrCreateCompanyResult> {
  const normalizedHost = normalizeWebsiteHost(input.website);

  if (normalizedHost) {
    const candidates = await prisma.company.findMany({
      where: { organizationId: input.organizationId, website: { not: null } },
    });
    const match = candidates.find((c) => normalizeWebsiteHost(c.website) === normalizedHost);
    if (match) {
      const company = await recordRediscovery(match, input.source);
      return { company, wasCreated: false };
    }
  }

  if (input.headquartersCountry) {
    const nameCountryMatch = await prisma.company.findFirst({
      where: {
        organizationId: input.organizationId,
        name: { equals: input.name, mode: "insensitive" },
        headquartersCountry: { equals: input.headquartersCountry, mode: "insensitive" },
      },
    });
    if (nameCountryMatch) {
      const company = await recordRediscovery(nameCountryMatch, input.source);
      return { company, wasCreated: false };
    }
  }

  const nameMatch = await prisma.company.findFirst({
    where: { organizationId: input.organizationId, name: { equals: input.name, mode: "insensitive" } },
  });
  if (nameMatch) {
    const company = await recordRediscovery(nameMatch, input.source);
    return { company, wasCreated: false };
  }

  const company = await prisma.company.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      website: input.website || null,
      domain: normalizedHost,
      industry: input.industry || null,
      email: input.email || null,
      phone: input.phone || null,
      notes: input.notes || null,
      source: input.source,
      status: input.status,
      sourceCount: 1,
      discoverySources: [input.source],
      lastDiscoveredAt: new Date(),
    },
  });
  return { company, wasCreated: true };
}

export interface FindOrCreateContactInput {
  organizationId: string;
  companyId?: string | null;
  firstName: string;
  lastName?: string | null;
  email: string;
  jobTitle?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
}

export interface FindOrCreateContactResult {
  contact: Contact;
  wasCreated: boolean;
}

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — the same "single choke
 * point" discipline as `findOrCreateCompany` above, for Contacts. Matches by
 * case-insensitive email within the organization ONLY (an email is the one
 * genuinely reliable real-world identity signal for a person — unlike a
 * company name, a person's display name is far too ambiguous to match on).
 * A match fills in `companyId` when the caller supplies one and the
 * existing row doesn't already have one (closes a real gap without
 * overwriting an existing, possibly more-correct, company link) — this is
 * the real "contact/company relationship" duplicate-prevention path Phase 1
 * asked for: re-discovering the same person at the company they're already
 * linked to never creates a second Contact row.
 */
export async function findOrCreateContact(input: FindOrCreateContactInput): Promise<FindOrCreateContactResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.contact.findFirst({
    where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" } },
  });

  if (existing) {
    const contact =
      !existing.companyId && input.companyId
        ? await prisma.contact.update({ where: { id: existing.id }, data: { companyId: input.companyId } })
        : existing;
    return { contact, wasCreated: false };
  }

  const contact = await prisma.contact.create({
    data: {
      organizationId: input.organizationId,
      companyId: input.companyId || null,
      firstName: input.firstName,
      lastName: input.lastName || null,
      email,
      jobTitle: input.jobTitle || null,
      phone: input.phone || null,
      country: input.country || null,
      city: input.city || null,
    },
  });
  return { contact, wasCreated: true };
}
