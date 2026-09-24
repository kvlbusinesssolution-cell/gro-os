import { prisma } from "@/lib/prisma";
import { isHunterConfigured, hunterAccountStatus, hunterVerifyEmail, hunterDomainSearch, hunterFindEmail } from "./providers/hunter-io";
import { isAbstractEmailConfigured, abstractValidateEmail } from "./providers/abstract-email-validation";
import { isProspeoConfigured, prospeoFindEmail } from "./providers/prospeo";
import type { ContactVerificationStatus, DataProvider } from "@/generated/prisma/client";

/**
 * The real multi-provider waterfall for Contact email verification — the
 * first genuine (non-format-only) email verification this codebase has ever
 * had (see dedup.ts's own doc comment: previously only a regex shape check
 * existed, honestly never claiming VERIFIED). Tries, in order:
 *   1. Hunter.io (if configured and its real monthly quota isn't exhausted)
 *   2. Abstract API (if configured) — independent free-tier fallback
 *   3. Falls through to UNVERIFIED (checked, inconclusive) rather than ever
 *      guessing VERIFIED/INVALID from nothing.
 * Every attempt is logged to DataProviderCallLog regardless of outcome —
 * the waterfall's own audit trail.
 */

export interface EmailWaterfallResult {
  status: ContactVerificationStatus;
  providerUsed: DataProvider | null;
  detail: string;
}

async function logCall(organizationId: string, provider: DataProvider, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider, target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/email-waterfall] failed to write call log:", error);
  }
}

export async function verifyContactEmailWaterfall(contactId: string): Promise<EmailWaterfallResult> {
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });

  // Idempotent — a contact already confirmed VERIFIED/INVALID doesn't need
  // re-checking on every enrichment run; RISKY/UNVERIFIED/UNKNOWN are worth
  // re-attempting since a provider might resolve them with more confidence
  // (e.g. a different provider, or the mailbox has since been fixed).
  if (contact.emailVerificationStatus === "VERIFIED" || contact.emailVerificationStatus === "INVALID") {
    return { status: contact.emailVerificationStatus, providerUsed: null, detail: "Already verified in a prior run — not re-checked." };
  }

  if (isHunterConfigured()) {
    const account = await hunterAccountStatus();
    if (account.ok && (account.verificationsRemaining ?? 0) > 0) {
      const result = await hunterVerifyEmail(contact.email);
      await logCall(contact.organizationId, "HUNTER_IO", contact.email, result.ok, result.ok ? `result=${result.result}` : (result.error ?? "unknown error"));
      if (result.ok && result.result) {
        const status = mapHunterResult(result.result);
        await applyStatus(contactId, status, `Hunter.io: ${result.result}${result.disposable ? " (disposable address)" : ""}`);
        return { status, providerUsed: "HUNTER_IO", detail: `Hunter.io verification: ${result.result}` };
      }
    } else {
      await logCall(contact.organizationId, "HUNTER_IO", contact.email, false, account.ok ? "monthly verification quota exhausted" : (account.error ?? "account check failed"));
    }
  }

  if (isAbstractEmailConfigured()) {
    const result = await abstractValidateEmail(contact.email);
    await logCall(contact.organizationId, "ABSTRACT_EMAIL_VALIDATION", contact.email, result.ok, result.ok ? `deliverability=${result.deliverability}` : (result.error ?? "unknown error"));
    if (result.ok && result.deliverability) {
      const status = mapAbstractResult(result.deliverability);
      await applyStatus(contactId, status, `Abstract API: ${result.deliverability}${result.isDisposable ? " (disposable address)" : ""}`);
      return { status, providerUsed: "ABSTRACT_EMAIL_VALIDATION", detail: `Abstract API validation: ${result.deliverability}` };
    }
  }

  return { status: contact.emailVerificationStatus, providerUsed: null, detail: "No email-verification provider configured or reachable — status left unchanged rather than guessed." };
}

function mapHunterResult(result: "deliverable" | "undeliverable" | "risky" | "unknown"): ContactVerificationStatus {
  switch (result) {
    case "deliverable":
      return "VERIFIED";
    case "undeliverable":
      return "INVALID";
    case "risky":
      return "RISKY";
    default:
      return "UNVERIFIED";
  }
}

function mapAbstractResult(result: "DELIVERABLE" | "UNDELIVERABLE" | "RISKY" | "UNKNOWN"): ContactVerificationStatus {
  switch (result) {
    case "DELIVERABLE":
      return "VERIFIED";
    case "UNDELIVERABLE":
      return "INVALID";
    case "RISKY":
      return "RISKY";
    default:
      return "UNVERIFIED";
  }
}

async function applyStatus(contactId: string, status: ContactVerificationStatus, evidenceFact: string): Promise<void> {
  await prisma.contact.update({ where: { id: contactId }, data: { emailVerificationStatus: status } });
  await prisma.contactEvidence.create({
    data: { contactId, kind: "RAW_FACT", fact: evidenceFact, source: "COMPANY_INTELLIGENCE", confidence: 1.0, fieldName: "emailVerificationStatus" },
  });
}

export interface EmailPatternDiscoveryResult {
  attempted: boolean;
  pattern: string | null;
  peopleFound: number;
}

/**
 * Real domain-wide discovery — finds the company's actual email naming
 * pattern (e.g. "{first}.{last}@domain.com") and any real named people
 * Hunter has indexed. Called once per company (not per contact) from
 * company-registry-waterfall.ts — cheap to skip on repeat runs since a
 * domain's email pattern rarely changes.
 */
export async function discoverCompanyEmailPattern(organizationId: string, domain: string): Promise<EmailPatternDiscoveryResult> {
  if (!isHunterConfigured()) return { attempted: false, pattern: null, peopleFound: 0 };

  const account = await hunterAccountStatus();
  if (!account.ok || (account.searchesRemaining ?? 0) <= 0) {
    await logCall(organizationId, "HUNTER_IO", domain, false, account.ok ? "monthly search quota exhausted" : (account.error ?? "account check failed"));
    return { attempted: false, pattern: null, peopleFound: 0 };
  }

  const result = await hunterDomainSearch(domain);
  await logCall(organizationId, "HUNTER_IO", domain, result.ok, result.ok ? `pattern=${result.pattern ?? "none"}, people=${result.people?.length ?? 0}` : (result.error ?? "unknown error"));
  if (!result.ok) return { attempted: true, pattern: null, peopleFound: 0 };
  return { attempted: true, pattern: result.pattern ?? null, peopleFound: result.people?.length ?? 0 };
}

/**
 * Re-exported for callers that already have a name + domain and want a
 * single real lookup rather than a full domain search. Falls through to
 * Prospeo (real name+company-website email finder, 100 free credits/month)
 * when Hunter is unconfigured or genuinely finds nothing — never a locally
 * guessed pattern either way.
 */
export async function findRealEmailForPerson(organizationId: string, domain: string, firstName: string, lastName: string): Promise<{ email: string | null; score: number | null }> {
  if (isHunterConfigured()) {
    const result = await hunterFindEmail(domain, firstName, lastName);
    await logCall(organizationId, "HUNTER_IO", `${firstName}.${lastName}@${domain}`, result.ok, result.ok ? `email=${result.email ?? "not found"}` : (result.error ?? "unknown error"));
    if (result.ok && result.email) return { email: result.email, score: result.score ?? null };
  }

  if (isProspeoConfigured()) {
    const fullName = `${firstName} ${lastName}`.trim();
    const result = await prospeoFindEmail(fullName, `https://${domain}`);
    await logCall(organizationId, "PROSPEO", `${fullName}@${domain}`, result.ok, result.ok ? `email=${result.email ?? "not found"}` : (result.error ?? "unknown error"));
    if (result.ok && result.email) return { email: result.email, score: null };
  }

  return { email: null, score: null };
}
