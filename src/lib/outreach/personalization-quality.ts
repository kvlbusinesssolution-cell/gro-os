import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";

/**
 * Phase 5: a real, deterministic, auditable "before you click Approve" check
 * over an `EmailDraft` — NOT another AI call. "No hallucinated claims" is
 * best enforced by checking a draft's text against real stored data, not by
 * asking an LLM to grade its own homework (which is exactly what generated
 * the draft in the first place). This module is read-only: it never
 * modifies the draft or its status — the existing approval-actions.ts state
 * machine (requestApproval/decideApproval/queueDraft/sendQueuedDraft) is
 * untouched; a separate UI surfaces `issues` to the human reviewer before
 * they act.
 */

const KVL_SERVICE_LABEL = new Map<string, string>(KVL_SERVICES.map((service) => [service.id, service.label]));

export interface QualityCheckResult {
  passed: boolean;
  issues: string[];
  checkedFields: {
    companyName: boolean;
    personName: boolean;
    companyFacts: boolean;
    opportunity: boolean;
    service: boolean;
    evidence: boolean;
  };
}

/**
 * Best-effort textual heuristic, NOT semantic verification: true when a
 * meaningful chunk of `sourceText` (a run of `windowWords` consecutive
 * words) turns up verbatim, case-insensitively, inside `bodyLower`. Real
 * drafts usually paraphrase a fact rather than quote it verbatim, so this
 * heuristic will under-count facts that were genuinely used but reworded —
 * a real, documented limitation, not a bug. It exists to catch the
 * clear-cut "this exact researched fact shows up in the email" case
 * cheaply and auditably, without a second AI call to "judge" the first.
 */
function textChunkAppears(sourceText: string, bodyLower: string, windowWords = 5): boolean {
  const words = sourceText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.length <= windowWords) {
    return bodyLower.includes(words.join(" "));
  }
  for (let i = 0; i <= words.length - windowWords; i++) {
    const chunk = words.slice(i, i + windowWords).join(" ");
    if (bodyLower.includes(chunk)) return true;
  }
  return false;
}

/**
 * Reads one real `EmailDraft` and checks it against the real data it should
 * be grounded in. Every field below is documented with exactly what it does
 * and does not verify — see each block's comment for the honest limitation.
 */
export async function checkDraftPersonalizationQuality(draftId: string): Promise<QualityCheckResult> {
  const draft = await prisma.emailDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      contact: {
        include: {
          company: {
            include: {
              leadOpportunities: true,
              evidence: true,
              intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  const bodyLower = (draft.body ?? "").toLowerCase();
  const company = draft.contact.company;
  const issues: string[] = [];

  // ----- companyName: does the draft mention the company's real name? -----
  const companyName = !!company && company.name.trim().length > 0 && bodyLower.includes(company.name.trim().toLowerCase());
  if (!companyName) {
    issues.push(
      company ? "Draft does not mention the company's real name." : "Contact has no company on file to check a company name against.",
    );
  }

  // ----- personName: does the draft mention the contact's real first name? -----
  // A generic "Hi Team" greeting fails this honestly when the contact
  // genuinely has no real first name on file — no special-casing to force a
  // pass for a missing/placeholder name.
  const firstName = draft.contact.firstName?.trim() ?? "";
  const personName = firstName.length > 0 && bodyLower.includes(firstName.toLowerCase());
  if (!personName) issues.push("Draft does not mention the contact's real first name.");

  // ----- companyFacts: does the draft reference anything resembling a real
  // researched fact? Light heuristic (see textChunkAppears): checks real
  // CompanyEvidence.fact rows AND the most recent CompanyIntelligence
  // summary fields for a verbatim-ish chunk inside the draft body. This is
  // a best-effort textual heuristic, not perfect semantic verification —
  // a paraphrased fact can be missed, and a coincidental short phrase match
  // could in principle be a false positive.
  let companyFacts = false;
  if (company) {
    companyFacts = company.evidence.some((row) => textChunkAppears(row.fact, bodyLower));
    if (!companyFacts) {
      const latestIntel = company.intelligenceRuns[0];
      if (latestIntel) {
        const summaryFields = [
          latestIntel.businessSummary,
          latestIntel.productsSummary,
          latestIntel.servicesSummary,
          latestIntel.techStackSummary,
          latestIntel.digitalPresenceSummary,
        ].filter((value): value is string => Boolean(value && value.trim().length > 0));
        companyFacts = summaryFields.some((text) => textChunkAppears(text, bodyLower));
      }
    }
  }
  if (!companyFacts) {
    issues.push("Draft does not appear to reference any real researched company fact (evidence or intelligence summary).");
  }

  // ----- opportunity: does the company have an open LeadOpportunity at all?
  // Existence check only — there is no reliable way to verify the AI
  // "used" the opportunity without deeper NLP than this module attempts, so
  // this is honestly just "is there a real opportunity to have grounded
  // this outreach in", not "did the draft reference it".
  const openOpportunity = company?.leadOpportunities.find((o) => o.status === "NEW" || o.status === "REVIEWED") ?? null;
  const opportunity = !!openOpportunity;
  if (!opportunity) {
    issues.push("Company has no open (NEW/REVIEWED) LeadOpportunity on file to ground this outreach in.");
  }

  // ----- service: does the matched opportunity's recommendedService's real
  // label appear in the draft body? When the opportunity has no
  // recommendedService yet, this check is vacuously not applicable — it
  // stays `true` and contributes no issue, which is intentionally distinct
  // from a genuine failure (a not-yet-matched service is not a quality
  // problem with the draft itself).
  let service = true;
  if (openOpportunity?.recommendedService) {
    const label = KVL_SERVICE_LABEL.get(openOpportunity.recommendedService) ?? openOpportunity.recommendedService;
    service = bodyLower.includes(label.toLowerCase());
    if (!service) issues.push(`Draft does not mention the recommended service (${label}).`);
  }

  // ----- evidence: does the company have real evidence on file at all to
  // ground this outreach in? Deliberately kept as its own, separately-named
  // existence-based check (mirrors the `opportunity` check's shape) rather
  // than being merged into `companyFacts` above: `companyFacts` verifies
  // the draft body textually references a real fact, while `evidence`
  // verifies real CompanyEvidence rows genuinely exist to ground it — the
  // two checks can and often will agree, but they are not the same
  // question, and keeping them separate leaves room for either heuristic to
  // be refined independently later without touching the other.
  const evidence = !!company && company.evidence.length > 0;
  if (!evidence) issues.push("No real CompanyEvidence exists yet for this company to ground the draft in.");

  const checkedFields = { companyName, personName, companyFacts, opportunity, service, evidence };
  const passed = companyName && personName && companyFacts && opportunity && service && evidence;

  return { passed, issues, checkedFields };
}
