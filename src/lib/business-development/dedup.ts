import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { classifyBuyerRole } from "./contact-classification";
import type { Company, CompanySource, CompanyStatus, Contact } from "@/generated/prisma/client";

/**
 * Phase 25 (invalid email test scenario) — real, cheap, deterministic
 * RFC-5322-shape check (not a deliverability/SMTP check, which needs a
 * real provider this codebase doesn't have — see the phase report).
 * Format validity IS a real fact; a malformed string genuinely can be
 * marked INVALID without fabricating anything. Never used to mark
 * VERIFIED — only ever narrows UNKNOWN down to INVALID for a clear
 * malformed case, everything else (a well-formed but unconfirmed address)
 * stays UNKNOWN.
 */
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailShape(email: string): boolean {
  return EMAIL_SHAPE_RE.test(email.trim());
}

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

/**
 * Conservative, deterministic name normalization for the exact-match name
 * tiers below — strips common legal-entity suffixes (Inc/LLC/Ltd/Pvt/Co/
 * Corp/etc, with or without trailing punctuation), all punctuation, and
 * collapses whitespace, then lowercases. Deliberately NOT a fuzzy/similarity
 * matcher (no Levenshtein/Jaccard scoring) — this only closes the gap where
 * "Acme Inc." and "Acme, Inc" are obviously the same real company but an
 * exact string comparison would miss them. A genuinely different company
 * with a similar-sounding name must still not match.
 */
// Anchored to the END of the string only (never matched mid-name or at the
// start) — a plain \b-bounded match anywhere would misfire on a real,
// distinguishing part of a brand name that happens to share a suffix token
// ("Co-Diagnostics" and "Diagnostics Inc" both collapsed to "diagnostics"
// before this fix, silently merging two unrelated companies). Applied in a
// loop below so multi-word suffixes ("Pvt Ltd", "Pvt. Ltd.") strip fully.
const TRAILING_LEGAL_SUFFIX_RE =
  /[,.\s]*\b(inc|incorporated|llc|ltd|limited|pvt|private|co|corp|corporation|company|plc|llp|gmbh|sa|srl|bv)\.?\s*$/i;

export function normalizeCompanyName(name: string): string {
  let working = name.toLowerCase().trim();
  let stripped = true;
  while (stripped) {
    const next = working.replace(TRAILING_LEGAL_SUFFIX_RE, "").trim();
    stripped = next !== working;
    working = next;
  }
  return working.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
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

  // Tier 1: exact domain match, backed by the real @@unique([organizationId,
  // domain]) index — a direct indexed lookup, not a full-table scan (Phase
  // 24 fix; `domain` is already the normalized host, stored at creation
  // below, so this compares like-for-like without re-deriving it in JS).
  // `mergedIntoId: null` on every lookup below (Phase 24, requirement #4):
  // a merged-away Company row must never be "found" as a live match — new
  // discovery activity always resolves to the real, surviving keeper.
  if (normalizedHost) {
    const match = await prisma.company.findFirst({
      where: { organizationId: input.organizationId, domain: normalizedHost, mergedIntoId: null },
    });
    if (match) {
      const company = await recordRediscovery(match, input.source);
      return { company, wasCreated: false };
    }
  }

  // Tiers 2-3: name matching, normalized (legal-suffix/punctuation/case
  // insensitive — see normalizeCompanyName) against every company already
  // in this org. Bounded by organizationId (indexed) the same way tier 1
  // is — not a cross-org scan.
  const normalizedTargetName = normalizeCompanyName(input.name);
  if (normalizedTargetName) {
    const orgCompanies = await prisma.company.findMany({
      where: { organizationId: input.organizationId, mergedIntoId: null },
      select: { id: true, name: true, headquartersCountry: true },
    });

    if (input.headquartersCountry) {
      const countryMatch = orgCompanies.find(
        (c) =>
          normalizeCompanyName(c.name) === normalizedTargetName &&
          (c.headquartersCountry ?? "").toLowerCase() === input.headquartersCountry!.toLowerCase(),
      );
      if (countryMatch) {
        const full = await prisma.company.findUniqueOrThrow({ where: { id: countryMatch.id } });
        const company = await recordRediscovery(full, input.source);
        return { company, wasCreated: false };
      }
    }

    const nameMatch = orgCompanies.find((c) => normalizeCompanyName(c.name) === normalizedTargetName);
    if (nameMatch) {
      const full = await prisma.company.findUniqueOrThrow({ where: { id: nameMatch.id } });
      const company = await recordRediscovery(full, input.source);
      return { company, wasCreated: false };
    }
  }

  const createData = {
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
  };

  try {
    const company = await prisma.company.create({ data: createData });
    await logAudit({
      organizationId: input.organizationId,
      action: "company.created",
      metadata: { companyId: company.id, name: company.name, domain: company.domain, source: input.source },
    });
    return { company, wasCreated: true };
  } catch (error) {
    // Phase 24 (requirement #18, retry safety): a real concurrent call — or
    // a retried job racing the original — can lose the check-then-create
    // race despite the tier-1 read above finding no match at the time. The
    // real @@unique([organizationId, domain]) constraint is the actual
    // safety net; P2002 here means another caller won it first, so re-read
    // and return that row instead of surfacing a raw constraint-violation
    // error to the caller.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && normalizedHost) {
      const winner = await prisma.company.findFirst({
        where: { organizationId: input.organizationId, domain: normalizedHost, mergedIntoId: null },
      });
      if (winner) {
        const company = await recordRediscovery(winner, input.source);
        return { company, wasCreated: false };
      }
    }
    throw error;
  }
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
  // Optional extra fields — every caller that doesn't supply these keeps
  // the same behavior as before (null/empty), matching every prior
  // findOrCreateContact call site.
  tags?: string[];
  status?: Contact["status"];
  notes?: string | null;
  linkedin?: string | null;
  department?: string | null;
  relationshipScore?: number | null;
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
 *
 * Phase 25 fixes:
 * - Job change: when a match already has a DIFFERENT real companyId than
 *   the one supplied, it is now genuinely updated (previously only ever
 *   filled in when empty — a returning contact who changed jobs kept their
 *   stale old-company link forever).
 * - Retry safety: backed by the real @@unique([organizationId, email])
 *   constraint (Phase 25) — a concurrent/retried call that loses the
 *   check-then-create race gets a real P2002, caught below and re-read,
 *   matching findOrCreateCompany's exact pattern.
 * - Merge-aware lookup: unlike Company (whose dedup key, `domain`, is
 *   nullable, so a merged-away row can be cleared and excluded), Contact's
 *   dedup key (`email`) is required and permanently unique per org — a
 *   merged-away Contact's email can never be freed up for a fresh row. So
 *   a match on a merged-away row transparently follows `mergedIntoId` to
 *   the real, live keeper and returns that instead (see contact-merge.ts)
 *   — never a constraint-violation error, never a silent duplicate.
 * - Invalid-email format detection: a genuinely malformed email sets
 *   `emailVerificationStatus: INVALID` at creation — never VERIFIED, only
 *   ever narrows UNKNOWN to INVALID for a clear format failure (see
 *   isValidEmailShape's own doc comment — no real deliverability provider
 *   exists in this codebase, disclosed honestly rather than faked).
 * - Buyer-role classification: a real, deterministic classification from
 *   jobTitle (contact-classification.ts) is set at creation.
 */
export async function findOrCreateContact(input: FindOrCreateContactInput): Promise<FindOrCreateContactResult> {
  const email = input.email.trim().toLowerCase();

  let existing = await prisma.contact.findFirst({
    where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" } },
  });

  // A match on a merged-away row resolves to its real, live keeper —
  // email uniqueness means the merged-away row's email can never be
  // reused for a genuinely fresh contact (see this function's own doc
  // comment above). Follows the chain to its terminal (non-merged) row,
  // not just one hop — a contact can itself have been re-merged again
  // after an earlier merge (A -> B -> C).
  while (existing?.mergedIntoId) {
    existing = await prisma.contact.findUnique({ where: { id: existing.mergedIntoId } });
  }

  if (existing) {
    // Fill-when-empty only, for every descriptive field below — a rediscovery/
    // enrichment pass has no way to know whether the current value came from
    // a human's own manual correction in the CRM (updateContact, a separate
    // direct-update path that never runs through this function) or from an
    // earlier, possibly-stale automated pass; overwriting whenever a new
    // value "merely differs" would silently clobber a human correction with
    // no evidence trail explaining why. companyId is the one deliberate
    // exception — a job change is a genuine real-world event worth always
    // reflecting (Phase 25 fix, see doc comment above), not stale data risk
    // in the same sense. Tags are additive-merged, never replaced, so an
    // automated pass can still contribute new tags without erasing ones a
    // human added.
    const updateData: Record<string, unknown> = {};
    if (input.companyId && input.companyId !== existing.companyId) {
      updateData.companyId = input.companyId;
      // Only a real job change (an already-known company being replaced by
      // a different one) sets the timestamp — a contact whose companyId was
      // simply empty until now is being filled in for the first time, not
      // moving jobs, so intent-scoring.ts's "Job change" signal must not
      // fire for that case.
      if (existing.companyId) updateData.companyChangedAt = new Date();
    }
    if (input.firstName && !existing.firstName) updateData.firstName = input.firstName;
    if (input.lastName && !existing.lastName) updateData.lastName = input.lastName;
    if (input.jobTitle && !existing.jobTitle) updateData.jobTitle = input.jobTitle;
    if (input.phone && !existing.phone) updateData.phone = input.phone;
    if (input.country && !existing.country) updateData.country = input.country;
    if (input.city && !existing.city) updateData.city = input.city;
    if (input.notes && !existing.notes) updateData.notes = input.notes;
    if (input.linkedin && !existing.linkedin) updateData.linkedin = input.linkedin;
    if (input.department && !existing.department) updateData.department = input.department;
    if (input.relationshipScore != null && existing.relationshipScore == null) {
      updateData.relationshipScore = input.relationshipScore;
    }
    if (input.tags && input.tags.length > 0) {
      const mergedTags = Array.from(new Set([...existing.tags, ...input.tags]));
      if (mergedTags.length !== existing.tags.length) updateData.tags = mergedTags;
    }

    const contact = Object.keys(updateData).length > 0
      ? await prisma.contact.update({ where: { id: existing.id }, data: updateData })
      : existing;
    return { contact, wasCreated: false };
  }

  const emailStatus = isValidEmailShape(email) ? undefined : ("INVALID" as const);

  const createData = {
    organizationId: input.organizationId,
    companyId: input.companyId || null,
    firstName: input.firstName,
    lastName: input.lastName || null,
    email,
    jobTitle: input.jobTitle || null,
    phone: input.phone || null,
    country: input.country || null,
    city: input.city || null,
    tags: input.tags ?? [],
    status: input.status,
    notes: input.notes || null,
    linkedin: input.linkedin || null,
    department: input.department || null,
    relationshipScore: input.relationshipScore ?? null,
    buyerRole: classifyBuyerRole(input.jobTitle),
    ...(emailStatus ? { emailVerificationStatus: emailStatus } : {}),
  };

  try {
    const contact = await prisma.contact.create({ data: createData });
    return { contact, wasCreated: true };
  } catch (error) {
    // Phase 25 (retry safety) — same real P2002-catch-and-reread pattern as
    // findOrCreateCompany.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      let winner = await prisma.contact.findFirst({
        where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" } },
      });
      if (winner?.mergedIntoId) {
        winner = await prisma.contact.findUnique({ where: { id: winner.mergedIntoId } });
      }
      if (winner) return { contact: winner, wasCreated: false };
    }
    throw error;
  }
}
