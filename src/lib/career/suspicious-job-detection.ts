/**
 * Phase 20 — §26 real, evidence-based suspicious-job detection. Every
 * finding is a real, bounded, quotable signal from the job's own source
 * text — never an unsupported accusation. This is a real-money-request /
 * phishing-pattern SCREEN, not a verdict — SUSPICIOUS/REVIEW_REQUIRED are
 * both hard blockers for autonomous submission (§48), the human still
 * makes the final call.
 */

export type ApplicationSuspicionStatus = "NOT_SUSPICIOUS" | "SUSPICIOUS" | "REVIEW_REQUIRED" | "UNKNOWN";

export interface SuspicionCheckResult {
  status: ApplicationSuspicionStatus;
  evidence: string[];
}

const HARD_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(registration|processing|application)\s+fee\b/i, label: "Mentions a registration/processing/application fee — legitimate employers do not charge candidates to apply." },
  { pattern: /\bwire\s+transfer\b|\bwestern\s+union\b|\bmoneygram\b/i, label: "Mentions wire transfer / money-transfer services — a common upfront-payment scam pattern." },
  { pattern: /\bsend\s+(us\s+)?your\s+(bank|routing|social security|ssn|passport|credit card)\b/i, label: "Directly asks for sensitive financial/identity credentials in the posting text." },
  { pattern: /\bpay\s+(a\s+)?deposit\b|\bpurchase\s+(your own\s+)?equipment\b/i, label: "Asks the candidate to pay a deposit or purchase equipment upfront." },
];

const SOFT_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\btelegram\b|\bwhatsapp\s+only\b/i, label: "Directs communication exclusively to Telegram/WhatsApp rather than a verifiable company channel." },
  { pattern: /\burgent(ly)?\s+hiring\b|\bstart\s+immediately\b.{0,30}no\s+interview\b/i, label: "Unusually urgent hiring language combined with no interview process — a common low-effort-scam pattern." },
];

export interface SuspiciousJobInput {
  description: string;
  company: string;
  companyDomain: string | null;
  canonicalUrl: string | null;
}

export function detectSuspiciousJob(input: SuspiciousJobInput): SuspicionCheckResult {
  const evidence: string[] = [];

  for (const { pattern, label } of HARD_SIGNALS) {
    if (pattern.test(input.description)) evidence.push(label);
  }
  const hardHit = evidence.length > 0;

  const softEvidence: string[] = [];
  for (const { pattern, label } of SOFT_SIGNALS) {
    if (pattern.test(input.description)) softEvidence.push(label);
  }

  // Missing company identity info is a real, weak signal on its own —
  // never sufficient alone to call SUSPICIOUS, only REVIEW_REQUIRED
  // alongside another soft signal.
  const missingIdentity = !input.companyDomain && !input.canonicalUrl;
  if (missingIdentity) softEvidence.push("No company domain or canonical source URL on file for this posting — identity cannot be independently verified.");

  if (hardHit) return { status: "SUSPICIOUS", evidence };
  if (softEvidence.length >= 2) return { status: "REVIEW_REQUIRED", evidence: softEvidence };
  if (softEvidence.length === 1) return { status: "UNKNOWN", evidence: softEvidence };
  return { status: "NOT_SUSPICIOUS", evidence: [] };
}
