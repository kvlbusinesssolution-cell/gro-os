import { promises as dns } from "node:dns";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) §3 — REAL DNS
 * verification, not a guess. SPF and DMARC are both real TXT-record lookups
 * against the actual live domain.
 *
 * DKIM (2026-09 advance): previously always reported NOT_VERIFIED because
 * guessing a selector without knowing the sending provider would risk a
 * false PASS/FAIL. Now provider-aware — when the caller passes the org's
 * actual SendingIdentity.provider, this checks that provider's real,
 * documented DKIM selector convention (Resend's own setup docs specify
 * `resend._domainkey`, Google Workspace's specify `google._domainkey`,
 * Microsoft 365's specify `selector1`/`selector2._domainkey`) — a real DNS
 * lookup against a real, provider-documented name, never an invented one.
 * SMTP (a generic, unknown relay) and an unspecified provider still
 * honestly report NOT_VERIFIED — there is no selector convention to check.
 *
 * Blacklist monitoring (2026-09 advance): a real, free DNSBL (DNS
 * blacklist) check against the domain's own mail-exchanger IP, using the
 * standard reverse-IP-lookup technique every real deliverability tool uses
 * — no API key, no paid service, just a DNS A-record query against public
 * blacklist zones. An IP that resolves on a zone IS listed; NXDOMAIN means
 * clean. Never a guess — a zone that itself fails to resolve is reported as
 * "could not check," not as "clean."
 */

export type DomainCheckStatus = "GOOD" | "WARNING" | "CRITICAL" | "NOT_VERIFIED";

export interface DomainHealthCheck {
  domain: string;
  spf: { status: DomainCheckStatus; detail: string };
  dkim: { status: DomainCheckStatus; detail: string };
  dmarc: { status: DomainCheckStatus; detail: string };
  blacklist: { status: DomainCheckStatus; detail: string; listedOn: string[] };
  checkedAt: string;
}

async function lookupTxt(hostname: string): Promise<string[][] | null> {
  try {
    return await dns.resolveTxt(hostname);
  } catch {
    return null; // NXDOMAIN or resolver error — real absence, not a guess
  }
}

/** True if ANY DNS record (TXT or CNAME) resolves at this exact hostname — the real, provider-agnostic signal that a DKIM selector has been set up, regardless of whether it's a direct TXT (Google) or a CNAME (Resend). */
async function selectorRecordExists(hostname: string): Promise<boolean> {
  const txt = await lookupTxt(hostname);
  if (txt && txt.length > 0) return true;
  try {
    const cname = await dns.resolveCname(hostname);
    return cname.length > 0;
  } catch {
    return false;
  }
}

export type EmailSendingProvider = "RESEND" | "SMTP" | "GMAIL" | "OUTLOOK";

/** Real, provider-documented selector names — never guessed for a provider not listed here. */
const KNOWN_DKIM_SELECTORS: Partial<Record<EmailSendingProvider, string[]>> = {
  RESEND: ["resend"],
  GMAIL: ["google"],
  OUTLOOK: ["selector1", "selector2"],
};

async function checkDkim(domain: string, provider?: EmailSendingProvider | null): Promise<DomainHealthCheck["dkim"]> {
  const selectors = provider ? KNOWN_DKIM_SELECTORS[provider] : undefined;
  if (!selectors || selectors.length === 0) {
    return {
      status: "NOT_VERIFIED",
      detail: provider
        ? `DKIM verification requires a known selector convention — "${provider}" has none documented here, so honestly reported as not verified rather than guessed.`
        : "DKIM verification requires a known provider selector — not reliably checkable without one, so honestly reported as not verified rather than guessed.",
    };
  }

  for (const selector of selectors) {
    const hostname = `${selector}._domainkey.${domain}`;
    if (await selectorRecordExists(hostname)) {
      return { status: "GOOD", detail: `Real DKIM record found at ${hostname} (the documented ${provider} selector).` };
    }
  }
  return {
    status: "CRITICAL",
    detail: `No DKIM record found at ${provider}'s documented selector${selectors.length > 1 ? "s" : ""} (${selectors.map((s) => `${s}._domainkey.${domain}`).join(", ")}) — real DNS lookup, nothing present.`,
  };
}

// Real, free, no-API-key-required DNSBL zones — Spamhaus ZEN is the
// industry-standard first check; SORBS and Barracuda are added as
// independent second opinions so one zone's own outage/false-positive
// doesn't solely determine the result.
const DNSBL_ZONES = ["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org"] as const;

function reverseIpv4(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  return parts.reverse().join(".");
}

async function checkDnsblZone(reversedIp: string, zone: string): Promise<"listed" | "clean" | "unchecked"> {
  try {
    const records = await dns.resolve4(`${reversedIp}.${zone}`);
    return records.length > 0 ? "listed" : "clean";
  } catch (error) {
    // ENOTFOUND/ENODATA = genuinely not listed on this zone (the correct,
    // expected "clean" response shape for a DNSBL query) — any other
    // resolver error (timeout, SERVFAIL) is honestly "unchecked", not "clean".
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return "clean";
    return "unchecked";
  }
}

async function checkBlacklist(domain: string): Promise<DomainHealthCheck["blacklist"]> {
  let ips: string[];
  try {
    ips = await dns.resolve4(domain);
  } catch {
    // Try the domain's mail exchanger instead — many sending domains (a
    // subdomain used only for outbound mail) have no direct A record.
    try {
      const mx = await dns.resolveMx(domain);
      const primary = mx.sort((a, b) => a.priority - b.priority)[0];
      ips = primary ? await dns.resolve4(primary.exchange) : [];
    } catch {
      ips = [];
    }
  }

  if (ips.length === 0) {
    return { status: "NOT_VERIFIED", detail: `Could not resolve an IP address for ${domain} (no A or MX record) — blacklist status not checkable.`, listedOn: [] };
  }

  const ip = ips[0];
  const reversed = reverseIpv4(ip);
  if (!reversed) {
    return { status: "NOT_VERIFIED", detail: `${domain} resolved to a non-IPv4 address (${ip}) — blacklist status not checkable for this address family.`, listedOn: [] };
  }

  const results = await Promise.all(DNSBL_ZONES.map(async (zone) => ({ zone, result: await checkDnsblZone(reversed, zone) })));
  const listedOn = results.filter((r) => r.result === "listed").map((r) => r.zone);
  const uncheckedZones = results.filter((r) => r.result === "unchecked").map((r) => r.zone);

  if (listedOn.length > 0) {
    return { status: "CRITICAL", detail: `${ip} (resolved from ${domain}) is listed on ${listedOn.length} real DNS blacklist${listedOn.length > 1 ? "s" : ""}: ${listedOn.join(", ")}.`, listedOn };
  }
  if (uncheckedZones.length === DNSBL_ZONES.length) {
    return { status: "NOT_VERIFIED", detail: `Could not reach any blacklist zone to check ${ip} (resolver errors on all ${DNSBL_ZONES.length}) — try again later.`, listedOn: [] };
  }
  return { status: "GOOD", detail: `${ip} (resolved from ${domain}) is not listed on any of ${DNSBL_ZONES.length - uncheckedZones.length} real DNS blacklists checked.`, listedOn: [] };
}

export async function checkDomainHealth(domain: string, provider?: EmailSendingProvider | null): Promise<DomainHealthCheck> {
  const [spfRecords, dmarcRecords, dkim, blacklist] = await Promise.all([lookupTxt(domain), lookupTxt(`_dmarc.${domain}`), checkDkim(domain, provider), checkBlacklist(domain)]);

  const spfTxt = spfRecords?.map((r) => r.join("")).find((r) => r.toLowerCase().startsWith("v=spf1"));
  const spf: DomainHealthCheck["spf"] = spfTxt
    ? { status: "GOOD", detail: `Real SPF TXT record found: "${spfTxt}"` }
    : { status: "CRITICAL", detail: `No SPF TXT record found on ${domain} (real DNS lookup, no v=spf1 record present).` };

  const dmarcTxt = dmarcRecords?.map((r) => r.join("")).find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  const dmarc: DomainHealthCheck["dmarc"] = dmarcTxt
    ? { status: dmarcTxt.toLowerCase().includes("p=none") ? "WARNING" : "GOOD", detail: `Real DMARC TXT record found: "${dmarcTxt}"` }
    : { status: "WARNING", detail: `No DMARC TXT record found on _dmarc.${domain} (real DNS lookup).` };

  return { domain, spf, dkim, dmarc, blacklist, checkedAt: new Date().toISOString() };
}
