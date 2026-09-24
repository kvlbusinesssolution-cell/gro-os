import { prisma } from "@/lib/prisma";
import { resolveFieldConflict } from "@/lib/business-development/evidence-priority";

/**
 * Real, zero-external-API phone-number finder — fetches the company's own
 * website HTML and looks for a `tel:` link first (an explicit,
 * unambiguous phone declaration), falling back to a conservative
 * visible-text digit pattern only when no `tel:` link exists. Never calls
 * a paid/rate-limited provider — this is a first-party observation of the
 * company's own published contact info, same class of evidence as
 * WEBSITE_SCAN. Only runs when Company.phone is still empty (fill-when-
 * empty; never overwrites an existing value with a scrape).
 */

const TEL_LINK_RE = /href=["']tel:([^"']+)["']/i;
// Conservative fallback: 7-15 digits with common separators, requiring at
// least one separator or a leading + so a random 7-digit number (e.g. part
// of an address or ID) is far less likely to false-positive.
const VISIBLE_PHONE_RE = /(\+?\d[\d\s().-]{8,17}\d)/;

export interface CompanyPhoneFinderResult {
  attempted: boolean;
  found: boolean;
}

async function logCall(organizationId: string, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider: "COMPANY_WEBSITE_SCRAPE", target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/company-phone-finder] failed to write call log:", error);
  }
}

function normalizePhoneCandidate(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-]/g, "");
  const digitCount = cleaned.replace(/^\+/, "").length;
  if (digitCount < 7 || digitCount > 15) return null;
  return raw.trim();
}

export async function enrichCompanyPhoneFromWebsite(companyId: string): Promise<CompanyPhoneFinderResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (company.phone) return { attempted: false, found: false };
  if (!company.website) return { attempted: false, found: false };

  const url = /^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`;

  let html: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await logCall(company.organizationId, url, false, `HTTP ${response.status}`);
      return { attempted: true, found: false };
    }
    html = await response.text();
  } catch (error) {
    await logCall(company.organizationId, url, false, error instanceof Error ? error.message : String(error));
    return { attempted: true, found: false };
  }

  const telMatch = html.match(TEL_LINK_RE);
  const candidate = telMatch ? normalizePhoneCandidate(decodeURIComponent(telMatch[1])) : null;
  const fallbackMatch = !candidate ? html.match(VISIBLE_PHONE_RE) : null;
  const phone = candidate ?? (fallbackMatch ? normalizePhoneCandidate(fallbackMatch[1]) : null);

  if (!phone) {
    await logCall(company.organizationId, url, true, "No phone number found");
    return { attempted: true, found: false };
  }

  const existingFieldEvidence = await prisma.companyEvidence.findMany({ where: { companyId, fieldName: "phone" }, select: { source: true } });
  const conflict = resolveFieldConflict("COMPANY_WEBSITE", existingFieldEvidence);
  if (conflict.shouldApplyToCompanyField) {
    await prisma.company.update({ where: { id: companyId }, data: { phone } });
  }

  const fact = `Phone number "${phone}" found on the company's own website.`;
  const existing = await prisma.companyEvidence.findFirst({ where: { companyId, source: "COMPANY_WEBSITE", fact }, select: { id: true } });
  if (!existing) {
    await prisma.companyEvidence.create({
      data: { companyId, kind: "RAW_FACT", fact, source: "COMPANY_WEBSITE", fieldName: "phone", confidence: telMatch ? 0.9 : 0.6 },
    });
  }

  await logCall(company.organizationId, url, true, `phone=${phone}`);
  return { attempted: true, found: true };
}
