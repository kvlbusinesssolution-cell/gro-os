import { prisma } from "@/lib/prisma";
import { isWappalyzerConfigured, wappalyzerLookup } from "./providers/wappalyzer";
import { resolveFieldConflict } from "@/lib/business-development/evidence-priority";

/**
 * Real, supplemental technology-detection signal for a company that has NO
 * WebsiteScan yet — this platform's own scanner (src/lib/scanner/) already
 * does deeper, full-render technology detection once a scan actually runs
 * (synced via syncCompanyTechnologiesFromScan), so this never duplicates
 * that work for a company that's already been scanned. Mirrors
 * syncCompanyTechnologiesFromScan's own CompanyEvidence-writing pattern
 * exactly (same fieldName, same resolveFieldConflict gate before touching
 * the Company.technologies scalar) so both sources compose safely.
 */

export interface WappalyzerTechnologySignalResult {
  attempted: boolean;
  detected: number;
  evidenceCreated: number;
}

async function logCall(organizationId: string, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider: "WAPPALYZER", target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/technology-signal] failed to write call log:", error);
  }
}

export async function enrichCompanyTechnologyIfNoScan(companyId: string): Promise<WappalyzerTechnologySignalResult> {
  if (!isWappalyzerConfigured()) return { attempted: false, detected: 0, evidenceCreated: 0 };

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.domain) return { attempted: false, detected: 0, evidenceCreated: 0 };

  const existingScan = await prisma.websiteScan.findFirst({ where: { companyId, status: "COMPLETED" }, select: { id: true } });
  if (existingScan) return { attempted: false, detected: 0, evidenceCreated: 0 };

  const result = await wappalyzerLookup(company.domain);
  await logCall(company.organizationId, company.domain, result.ok, result.ok ? `${result.technologies?.length ?? 0} technologies` : (result.error ?? "unknown error"));
  if (!result.ok || !result.technologies || result.technologies.length === 0) return { attempted: true, detected: 0, evidenceCreated: 0 };

  const dedupedNames = [...new Set(result.technologies.map((t) => t.name))];

  const existingFieldEvidence = await prisma.companyEvidence.findMany({ where: { companyId, fieldName: "technologies" }, select: { source: true } });
  const conflict = resolveFieldConflict("WAPPALYZER", existingFieldEvidence);
  if (conflict.shouldApplyToCompanyField) {
    await prisma.company.update({ where: { id: companyId }, data: { technologies: dedupedNames } });
  }

  const candidateFacts = result.technologies.map((t) => `Uses ${t.name}${t.categories.length ? ` (${t.categories.join(", ")})` : ""} — detected via Wappalyzer.`);
  const existing = await prisma.companyEvidence.findMany({ where: { companyId, source: "WAPPALYZER", fact: { in: candidateFacts } }, select: { fact: true } });
  const existingFacts = new Set(existing.map((e) => e.fact));

  const rowsToCreate = candidateFacts.filter((fact) => !existingFacts.has(fact)).filter((fact, index, arr) => arr.indexOf(fact) === index);

  if (rowsToCreate.length > 0) {
    await prisma.companyEvidence.createMany({
      data: rowsToCreate.map((fact) => ({ companyId, kind: "RAW_FACT" as const, fact, source: "WAPPALYZER" as const, fieldName: "technologies", confidence: 0.85 })),
    });
  }

  return { attempted: true, detected: result.technologies.length, evidenceCreated: rowsToCreate.length };
}
