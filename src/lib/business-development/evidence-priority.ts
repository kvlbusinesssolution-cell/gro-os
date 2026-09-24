import type { EvidenceSource } from "@/generated/prisma/client";

/**
 * Phase 24 (requirement #6, source priority) — a real, explicit precedence
 * order for resolving disagreeing sources. Higher number wins. A human
 * manually entering/correcting a fact is the most trustworthy real signal
 * available (MANUAL); a bulk CSV import is usually curated by a real person
 * too, just batched (slightly below manual since it isn't a live human
 * decision at write time); a live website scan is a real, current, direct
 * observation; a web-search-derived fact is real but one hop further from
 * the primary source; an AI interpretation derived from other evidence
 * (COMPANY_INTELLIGENCE) is the least direct and ranks lowest.
 *
 * OPENCORPORATES/UK_COMPANIES_HOUSE (company-registry-waterfall.ts) are a
 * real government/legal-registry filing — a genuinely higher-confidence
 * source than any AI-derived fact, and more authoritative than a bulk CSV
 * import, but still ranked below MANUAL: a deliberate human correction must
 * always be able to win even over an official filing (e.g. a stale registry
 * record for a company that has since re-registered under a new name).
 *
 * WAPPALYZER (technology-signal.ts) is a real, measured technology
 * detection — same class of evidence as WEBSITE_SCAN's own detector — but
 * ranked just below it: it's a lighter, independent lookup used only when
 * this platform's own deeper full-render scan hasn't run yet for that
 * company, so a real scan result should still win if one exists.
 *
 * COMPANY_WEBSITE (company-phone-finder.ts) is a phone number scraped
 * directly from the company's own site — a first-party observation, same
 * class and rank as WEBSITE_SCAN.
 *
 * FMP (company-size-finder.ts) and SEC_EDGAR (company-funding-finder.ts)
 * are real third-party lookups, not first-party observations: FMP ranks
 * with WEB_SEARCH (a real but one-hop-removed fact), while SEC_EDGAR is an
 * authoritative US government filing — ranked with
 * OPENCORPORATES/UK_COMPANIES_HOUSE, still below MANUAL.
 *
 * PROSPEO (contact-phone-linkedin-finder.ts) is a real third-party person
 * lookup — ranked with WAPPALYZER, its closest analog on the Contact side.
 */
const SOURCE_PRIORITY: Record<EvidenceSource, number> = {
  MANUAL: 100,
  UK_COMPANIES_HOUSE: 95,
  OPENCORPORATES: 95,
  SEC_EDGAR: 95,
  CSV_IMPORT: 90,
  WEBSITE_SCAN: 80,
  COMPANY_WEBSITE: 80,
  WAPPALYZER: 70,
  PROSPEO: 70,
  WEB_SEARCH: 60,
  FMP: 60,
  COMPANY_INTELLIGENCE: 40,
};

export function sourcePriority(source: EvidenceSource): number {
  return SOURCE_PRIORITY[source];
}

export interface ExistingFieldEvidence {
  source: EvidenceSource;
}

export interface FieldConflictResolution {
  /**
   * Whether the caller should go ahead and write the new value onto the
   * Company scalar field. False means: record the new CompanyEvidence row
   * regardless (never lose the observation), but do NOT overwrite the
   * field — the existing value is backed by a higher- or equal-priority
   * source and a lower-priority source must not silently win.
   */
  shouldApplyToCompanyField: boolean;
  reason: string;
}

/**
 * Phase 24 (requirement #7, conflicting source handling) — decides whether
 * a new piece of evidence for `fieldName` is allowed to overwrite the
 * Company scalar field it supports. `existingEvidence` is every
 * CompanyEvidence row already on file for this exact field (query by
 * `{ companyId, fieldName }` — see the new `CompanyEvidence_companyId_fieldName_idx`
 * index). No existing evidence for this field at all means there's nothing
 * to conflict with — the new value is always applied.
 */
export function resolveFieldConflict(
  newSource: EvidenceSource,
  existingEvidence: ExistingFieldEvidence[],
): FieldConflictResolution {
  if (existingEvidence.length === 0) {
    return { shouldApplyToCompanyField: true, reason: "No prior evidence for this field — nothing to conflict with." };
  }

  const highestExistingPriority = Math.max(...existingEvidence.map((e) => sourcePriority(e.source)));
  const newPriority = sourcePriority(newSource);

  if (newPriority >= highestExistingPriority) {
    return {
      shouldApplyToCompanyField: true,
      reason: `New source (${newSource}, priority ${newPriority}) outranks or matches the highest existing source priority (${highestExistingPriority}).`,
    };
  }

  return {
    shouldApplyToCompanyField: false,
    reason: `New source (${newSource}, priority ${newPriority}) is lower-priority than existing evidence (highest priority ${highestExistingPriority}) — evidence recorded, Company field left unchanged.`,
  };
}
