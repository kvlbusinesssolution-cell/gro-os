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
 */
const SOURCE_PRIORITY: Record<EvidenceSource, number> = {
  MANUAL: 100,
  CSV_IMPORT: 90,
  WEBSITE_SCAN: 80,
  WEB_SEARCH: 60,
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
