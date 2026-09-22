import { prisma } from "@/lib/prisma";
import type { Technology } from "@/generated/prisma/client";

/**
 * Human-readable clause describing what each Technology.category means when
 * a technology is used for it — plugged into the CompanyEvidence sentence
 * below. Falls back to a bare name mention for OTHER.
 */
const CATEGORY_CLAUSE: Record<string, string> = {
  FRONTEND: "as its frontend framework",
  BACKEND: "as its backend/language signal",
  CMS: "as its CMS",
  ECOMMERCE: "as its e-commerce platform",
  HOSTING: "for hosting",
  CDN: "as its CDN",
  ANALYTICS: "for analytics",
  PAYMENT: "for payments",
  BOOKING: "for online booking/scheduling",
  CRM_INDICATOR: "as a CRM signal",
  MESSAGING: "for customer messaging",
  OTHER: "",
};

/**
 * Every one of this file's signature matches comes from one of four real,
 * structurally-validated sources (a parsed <script src>, an HTTP response
 * header, a Set-Cookie cookie name, or a <meta name="generator"> tag) or
 * from a raw substring/regex search across the whole HTML document. The
 * former is a direct, low-false-positive match on a specific asset/protocol
 * field; the latter can in principle match text that isn't really the
 * technology (e.g. the domain mentioned in body copy), so it's rated lower.
 * This mirrors exactly how technology-detector.ts's own helpers
 * (scriptSrcMatches/headerIncludes/cookieIncludes vs htmlIncludes) are
 * built — never an invented number disconnected from what was matched.
 */
function confidenceForEvidence(evidence: string): number {
  const directPrefixes = ["Script source containing", "Header ", "Cookie name matches", "Meta generator tag"];
  return directPrefixes.some((prefix) => evidence.startsWith(prefix)) ? 0.95 : 0.75;
}

function buildFact(tech: Pick<Technology, "name" | "category" | "evidence">): string {
  const clause = CATEGORY_CLAUSE[tech.category] ?? "";
  const suffix = clause ? ` ${clause}` : "";
  return `Uses ${tech.name}${suffix} (${tech.evidence}).`;
}

/**
 * The real resync fix for `Company.technologies` (previously only written
 * once at company-creation time and never updated). Reads the Technology
 * rows this scan actually detected, replaces `Company.technologies` with
 * their de-duplicated names, and records a `CompanyEvidence` row per
 * detection so the detection is independently auditable later. Idempotent:
 * re-running against the same scan (e.g. a retried scheduled job) never
 * creates duplicate CompanyEvidence rows.
 */
export async function syncCompanyTechnologiesFromScan(companyId: string, websiteScanId: string): Promise<{ detected: number; evidenceCreated: number }> {
  const scan = await prisma.websiteScan.findUnique({
    where: { id: websiteScanId },
    include: { technologies: true },
  });
  if (!scan) return { detected: 0, evidenceCreated: 0 };

  const technologies = scan.technologies;
  const sourceUrl = scan.finalUrl ?? scan.url ?? null;

  const dedupedNames = [...new Set(technologies.map((t) => t.name))];
  await prisma.company.update({
    where: { id: companyId },
    data: { technologies: dedupedNames },
  });

  if (technologies.length === 0) {
    return { detected: 0, evidenceCreated: 0 };
  }

  const candidateFacts = technologies.map((t) => buildFact(t));
  const existing = await prisma.companyEvidence.findMany({
    where: { companyId, source: "WEBSITE_SCAN", fact: { in: candidateFacts } },
    select: { fact: true },
  });
  const existingFacts = new Set(existing.map((e) => e.fact));

  const rowsToCreate = technologies
    .map((t) => ({ tech: t, fact: buildFact(t) }))
    .filter(({ fact }) => !existingFacts.has(fact))
    // A single scan could (in principle) detect the same technology name twice via two
    // different signature clauses producing an identical fact string — dedupe within this
    // batch too so we never try to insert the same fact twice in one call.
    .filter(({ fact }, index, arr) => arr.findIndex((r) => r.fact === fact) === index);

  if (rowsToCreate.length > 0) {
    await prisma.companyEvidence.createMany({
      data: rowsToCreate.map(({ tech, fact }) => ({
        companyId,
        kind: "RAW_FACT" as const,
        fact,
        source: "WEBSITE_SCAN" as const,
        sourceUrl,
        // Phase 24 (requirement #5): this evidence directly supports
        // Company.technologies specifically, not a generic company fact.
        fieldName: "technologies",
        confidence: confidenceForEvidence(tech.evidence),
      })),
    });
  }

  return { detected: technologies.length, evidenceCreated: rowsToCreate.length };
}
