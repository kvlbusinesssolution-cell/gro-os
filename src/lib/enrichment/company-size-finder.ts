import { prisma } from "@/lib/prisma";
import { isFmpConfigured, fmpSearchSymbol, fmpCompanyProfile } from "./providers/fmp";
import { resolveFieldConflict } from "@/lib/business-development/evidence-priority";

/**
 * Real employee-count lookup via Financial Modeling Prep — only ever finds
 * a result for a publicly-traded/SEC-reporting company (FMP's own
 * coverage limit; a private company genuinely has no FMP symbol, which is
 * a real "not found," never a guess). Only runs when Company.employeeCount
 * is still empty (fill-when-empty).
 */

export interface CompanySizeFinderResult {
  attempted: boolean;
  found: boolean;
}

async function logCall(organizationId: string, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider: "FMP", target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/company-size-finder] failed to write call log:", error);
  }
}

export async function enrichCompanySizeFromFmp(companyId: string): Promise<CompanySizeFinderResult> {
  if (!isFmpConfigured()) return { attempted: false, found: false };

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (company.employeeCount) return { attempted: false, found: false };

  const symbolResult = await fmpSearchSymbol(company.name);
  if (!symbolResult.ok || !symbolResult.symbol) {
    await logCall(company.organizationId, company.name, false, symbolResult.error ?? "No matching symbol");
    return { attempted: true, found: false };
  }

  const profileResult = await fmpCompanyProfile(symbolResult.symbol);
  if (!profileResult.ok || profileResult.fullTimeEmployees === null || profileResult.fullTimeEmployees === undefined) {
    await logCall(company.organizationId, symbolResult.symbol, false, profileResult.error ?? "No employee count reported");
    return { attempted: true, found: false };
  }

  const employeeCount = profileResult.fullTimeEmployees;

  const existingFieldEvidence = await prisma.companyEvidence.findMany({ where: { companyId, fieldName: "employeeCount" }, select: { source: true } });
  const conflict = resolveFieldConflict("FMP", existingFieldEvidence);
  if (conflict.shouldApplyToCompanyField) {
    await prisma.company.update({ where: { id: companyId }, data: { employeeCount } });
  }

  const fact = `Reports ${employeeCount} full-time employees (symbol ${symbolResult.symbol}) — via Financial Modeling Prep.`;
  const existing = await prisma.companyEvidence.findFirst({ where: { companyId, source: "FMP", fact }, select: { id: true } });
  if (!existing) {
    await prisma.companyEvidence.create({
      data: { companyId, kind: "RAW_FACT", fact, source: "FMP", fieldName: "employeeCount", confidence: 0.9 },
    });
  }

  await logCall(company.organizationId, symbolResult.symbol, true, `employeeCount=${employeeCount}`);
  return { attempted: true, found: true };
}
