import { prisma } from "@/lib/prisma";
import { isSecEdgarConfigured, edgarFindFormDFilings } from "./providers/sec-edgar";
import { resolveFieldConflict } from "@/lib/business-development/evidence-priority";

/**
 * Real funding-activity signal via SEC EDGAR's Form D full-text search —
 * US-only coverage, a genuine, disclosed limitation. A Form D confirms a
 * real private-placement filing happened on a specific date; it does NOT
 * reliably expose an exact dollar amount from full-text search alone, so
 * this deliberately never fabricates a `fundingAmount` — only the real,
 * disclosed filing fact (date + a real link) is recorded. Re-runs are
 * safe: each filing is deduped by its own SEC accession number before a
 * new CompanyEvidence row is written.
 */

export interface CompanyFundingFinderResult {
  attempted: boolean;
  filingsFound: number;
  evidenceCreated: number;
}

async function logCall(organizationId: string, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider: "SEC_EDGAR", target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/company-funding-finder] failed to write call log:", error);
  }
}

export async function enrichCompanyFundingFromEdgar(companyId: string): Promise<CompanyFundingFinderResult> {
  if (!isSecEdgarConfigured()) return { attempted: false, filingsFound: 0, evidenceCreated: 0 };

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const result = await edgarFindFormDFilings(company.name);
  await logCall(company.organizationId, company.name, result.ok, result.ok ? `${result.filings?.length ?? 0} Form D filing(s)` : (result.error ?? "unknown error"));
  if (!result.ok || !result.filings || result.filings.length === 0) {
    return { attempted: true, filingsFound: 0, evidenceCreated: 0 };
  }

  const candidateFacts = result.filings.map(
    (f) => `Filed a Form D (private placement notice) with the SEC on ${f.filingDate} under the name "${f.entityName}" (accession ${f.accessionNumber}). See https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${f.accessionNumber}`,
  );
  const existing = await prisma.companyEvidence.findMany({ where: { companyId, source: "SEC_EDGAR", fact: { in: candidateFacts } }, select: { fact: true } });
  const existingFacts = new Set(existing.map((e) => e.fact));
  const rowsToCreate = candidateFacts.filter((fact) => !existingFacts.has(fact));

  if (rowsToCreate.length > 0) {
    await prisma.companyEvidence.createMany({
      data: rowsToCreate.map((fact) => ({ companyId, kind: "RAW_FACT" as const, fact, source: "SEC_EDGAR" as const, fieldName: "fundingStage", confidence: 1.0 })),
    });
  }

  const existingFieldEvidence = await prisma.companyEvidence.findMany({ where: { companyId, fieldName: "fundingStage" }, select: { source: true } });
  const conflict = resolveFieldConflict("SEC_EDGAR", existingFieldEvidence);
  const mostRecentFilingDate = result.filings.map((f) => f.filingDate).sort().at(-1);
  const updateData: { fundingStage?: string; fundingDate?: Date } = {};
  if (conflict.shouldApplyToCompanyField && !company.fundingStage) {
    updateData.fundingStage = "Private placement (SEC Form D)";
  }
  if (conflict.shouldApplyToCompanyField && !company.fundingDate && mostRecentFilingDate) {
    updateData.fundingDate = new Date(mostRecentFilingDate);
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.company.update({ where: { id: companyId }, data: updateData });
  }

  return { attempted: true, filingsFound: result.filings.length, evidenceCreated: rowsToCreate.length };
}
