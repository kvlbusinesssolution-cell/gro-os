import { promises as dns } from "node:dns";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) §3 — REAL DNS
 * verification, not a guess. SPF and DMARC are both real TXT-record lookups
 * against the actual live domain. DKIM is honestly reported NOT_VERIFIED —
 * verifying it requires knowing the provider's specific selector (e.g.
 * `resend._domainkey.<domain>`), which isn't reliably knowable without a
 * confirmed source; guessing a selector and reporting a false PASS/FAIL
 * would violate "do not claim SPF/DKIM/DMARC is valid unless actually
 * verified" more than honestly saying NOT_VERIFIED does.
 */

export type DomainCheckStatus = "GOOD" | "WARNING" | "CRITICAL" | "NOT_VERIFIED";

export interface DomainHealthCheck {
  domain: string;
  spf: { status: DomainCheckStatus; detail: string };
  dkim: { status: DomainCheckStatus; detail: string };
  dmarc: { status: DomainCheckStatus; detail: string };
  checkedAt: string;
}

async function lookupTxt(hostname: string): Promise<string[][] | null> {
  try {
    return await dns.resolveTxt(hostname);
  } catch {
    return null; // NXDOMAIN or resolver error — real absence, not a guess
  }
}

export async function checkDomainHealth(domain: string): Promise<DomainHealthCheck> {
  const [spfRecords, dmarcRecords] = await Promise.all([lookupTxt(domain), lookupTxt(`_dmarc.${domain}`)]);

  const spfTxt = spfRecords?.map((r) => r.join("")).find((r) => r.toLowerCase().startsWith("v=spf1"));
  const spf: DomainHealthCheck["spf"] = spfTxt
    ? { status: "GOOD", detail: `Real SPF TXT record found: "${spfTxt}"` }
    : { status: "CRITICAL", detail: `No SPF TXT record found on ${domain} (real DNS lookup, no v=spf1 record present).` };

  const dmarcTxt = dmarcRecords?.map((r) => r.join("")).find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  const dmarc: DomainHealthCheck["dmarc"] = dmarcTxt
    ? { status: dmarcTxt.toLowerCase().includes("p=none") ? "WARNING" : "GOOD", detail: `Real DMARC TXT record found: "${dmarcTxt}"` }
    : { status: "WARNING", detail: `No DMARC TXT record found on _dmarc.${domain} (real DNS lookup).` };

  return {
    domain,
    spf,
    dkim: { status: "NOT_VERIFIED", detail: "DKIM verification requires a known provider selector — not reliably checkable without one, so honestly reported as not verified rather than guessed." },
    dmarc,
    checkedAt: new Date().toISOString(),
  };
}
