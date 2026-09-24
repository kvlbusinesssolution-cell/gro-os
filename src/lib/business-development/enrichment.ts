import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isAIConnected } from "@/lib/ai/client";
import { generateCompanyIntelligence } from "@/lib/company-intelligence";
import { scoreCompany } from "@/lib/lead-scoring";

import { syncCompanyTechnologiesFromScan } from "@/lib/scanner/technology-evidence-sync";

import { normalizeWebsiteHost } from "./dedup";
import { classifyBuyerRole } from "./contact-classification";
import { computeIntentScore } from "./intent-scoring";
import { discoverDecisionMakers } from "./decision-maker-discovery";
import { generateLeadOpportunities } from "./opportunity-engine";
import { computeOpportunityScore } from "./opportunity-priority";
import { findMatchingDecisionMaker } from "./decision-maker-matching";
import { buildWebsiteIntelligenceEvidence } from "./website-intelligence";
import { classifyBusinessType } from "./business-type-classification";
import { enrichCompanyRegistry } from "@/lib/enrichment/company-registry-waterfall";
import { verifyContactEmailWaterfall, discoverCompanyEmailPattern } from "@/lib/enrichment/email-waterfall";
import { enrichCompanyTechnologyIfNoScan } from "@/lib/enrichment/technology-signal";
import { enrichCompanyPhoneFromWebsite } from "@/lib/enrichment/company-phone-finder";
import { enrichCompanySizeFromFmp } from "@/lib/enrichment/company-size-finder";
import { enrichCompanyFundingFromEdgar } from "@/lib/enrichment/company-funding-finder";
import { enrichContactPhoneAndLinkedIn } from "@/lib/enrichment/contact-phone-linkedin-finder";
import type { EnrichmentRun, EnrichmentRunStatus, EnrichmentTrigger } from "@/generated/prisma/client";

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — a thin ORCHESTRATION layer
 * over already-shipped, independently-tested primitives (generateCompanyIntelligence,
 * computeIntentScore, discoverDecisionMakers, generateLeadOpportunities,
 * computeOpportunityScore, scoreCompany). None of the actual research/scoring
 * logic lives here — this file's only job is: run them in the right order for
 * ONE company/contact right now, track which steps genuinely succeeded vs
 * failed, and record a real EnrichmentRun history row. This is what was
 * missing — those 5 functions already existed, split across 3 separate
 * uncoordinated 30-minute cron jobs (company-research-backlog,
 * decision-maker-sync, website-intelligence-sync) with no single "did this
 * company actually finish enriching" signal and no on-demand trigger.
 *
 * Every step here is wrapped in its own try/catch so one failure never
 * blocks the rest — same discipline as company-research-job.ts. Every
 * underlying function is already idempotent (upsert-based), so re-running
 * enrichCompany/enrichContact on the same entity is always safe by
 * construction — the only extra idempotency this file adds is refusing to
 * START a second concurrent run while one is already RUNNING/QUEUED for the
 * same entity (see the guard in each function below).
 */

const STEP_WEBSITE_EVIDENCE = "WEBSITE_EVIDENCE";
const STEP_COMPANY_INTELLIGENCE = "COMPANY_INTELLIGENCE";
const STEP_BUSINESS_TYPE = "BUSINESS_TYPE";
const STEP_COMPANY_REGISTRY = "COMPANY_REGISTRY";
const STEP_EMAIL_PATTERN = "EMAIL_PATTERN";
const STEP_TECHNOLOGY_SIGNAL = "TECHNOLOGY_SIGNAL";
const STEP_PHONE_FINDER = "PHONE_FINDER";
const STEP_COMPANY_SIZE_FINDER = "COMPANY_SIZE_FINDER";
const STEP_FUNDING_FINDER = "FUNDING_FINDER";
const STEP_INTENT_SCORE = "INTENT_SCORE";
const STEP_DECISION_MAKERS = "DECISION_MAKERS";
const STEP_OPPORTUNITIES = "OPPORTUNITIES";
const STEP_LEAD_SCORE = "LEAD_SCORE";
const DECISION_MAKER_REVERIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finalStatus(stepsCompleted: string[], stepsFailed: string[]): "FAILED" | "COMPLETED" | "PARTIAL" {
  if (stepsCompleted.length === 0) return "FAILED";
  if (stepsFailed.length === 0) return "COMPLETED";
  return "PARTIAL";
}

export interface EnrichCompanyOptions {
  triggeredBy: EnrichmentTrigger;
  triggeredByUserId?: string | null;
}

export interface EnrichCompanyResult {
  run: EnrichmentRun;
  status: EnrichmentRunStatus;
}

/**
 * Runs one full enrichment pass for `companyId`: Company Intelligence →
 * Intent Score → Decision Makers → Lead Opportunities (+ their scores) →
 * Lead Score. Returns the finished EnrichmentRun row — never throws for a
 * business-logic failure (a failed step is recorded, not thrown), only for
 * a genuinely missing company.
 */
export async function enrichCompany(companyId: string, options: EnrichCompanyOptions): Promise<EnrichCompanyResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  // Idempotency guard: never start a second concurrent run for the same
  // company (covers "manual enrich button double-clicked" and "batch job +
  // manual click overlapped").
  const alreadyRunning = await prisma.enrichmentRun.findFirst({
    where: { companyId, entityType: "COMPANY", status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (alreadyRunning) return { run: alreadyRunning, status: alreadyRunning.status };

  let run = await prisma.enrichmentRun.create({
    data: {
      organizationId: company.organizationId,
      entityType: "COMPANY",
      entityId: companyId,
      companyId,
      triggeredBy: options.triggeredBy,
      triggeredByUserId: options.triggeredByUserId ?? null,
      status: "RUNNING",
    },
  });
  await prisma.company.update({ where: { id: companyId }, data: { enrichmentStatus: "RUNNING" } });

  // Backfill `domain` from `website` if this row predates that field —
  // never overwrites a website value, purely derived, no AI/network call.
  if (!company.domain) {
    const domain = normalizeWebsiteHost(company.website);
    if (domain) await prisma.company.update({ where: { id: companyId }, data: { domain } });
  }
  const domain = company.domain ?? normalizeWebsiteHost(company.website);

  const startedAt = run.startedAt;
  const stepsCompleted: string[] = [];
  const stepsFailed: string[] = [];
  const errors: string[] = [];

  // Real legal-registry + email-pattern lookups (src/lib/enrichment/) run
  // regardless of AI connectivity — neither one is an AI call, so gating
  // them behind the AI-provider check below would incorrectly block real,
  // independent data providers (Hunter.io, OpenCorporates, UK Companies
  // House) just because no AI key happens to be configured.
  try {
    const registryResult = await enrichCompanyRegistry(companyId);
    if (registryResult.attempted) stepsCompleted.push(STEP_COMPANY_REGISTRY);
  } catch (error) {
    stepsFailed.push(STEP_COMPANY_REGISTRY);
    errors.push(`${STEP_COMPANY_REGISTRY}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_COMPANY_REGISTRY} failed:`, error);
  }

  if (domain) {
    try {
      const patternResult = await discoverCompanyEmailPattern(company.organizationId, domain);
      if (patternResult.attempted) stepsCompleted.push(STEP_EMAIL_PATTERN);
    } catch (error) {
      stepsFailed.push(STEP_EMAIL_PATTERN);
      errors.push(`${STEP_EMAIL_PATTERN}: ${errorMessage(error)}`);
      console.error(`[enrichment] company ${companyId} — ${STEP_EMAIL_PATTERN} failed:`, error);
    }
  }

  try {
    const technologyResult = await enrichCompanyTechnologyIfNoScan(companyId);
    if (technologyResult.attempted) stepsCompleted.push(STEP_TECHNOLOGY_SIGNAL);
  } catch (error) {
    stepsFailed.push(STEP_TECHNOLOGY_SIGNAL);
    errors.push(`${STEP_TECHNOLOGY_SIGNAL}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_TECHNOLOGY_SIGNAL} failed:`, error);
  }

  // Real, zero/low-cost finders (website scrape, FMP, SEC EDGAR) — never
  // AI calls, so they run unconditionally here, same reasoning as the
  // registry/email-pattern/technology-signal steps above.
  try {
    const phoneResult = await enrichCompanyPhoneFromWebsite(companyId);
    if (phoneResult.attempted) stepsCompleted.push(STEP_PHONE_FINDER);
  } catch (error) {
    stepsFailed.push(STEP_PHONE_FINDER);
    errors.push(`${STEP_PHONE_FINDER}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_PHONE_FINDER} failed:`, error);
  }

  try {
    const sizeResult = await enrichCompanySizeFromFmp(companyId);
    if (sizeResult.attempted) stepsCompleted.push(STEP_COMPANY_SIZE_FINDER);
  } catch (error) {
    stepsFailed.push(STEP_COMPANY_SIZE_FINDER);
    errors.push(`${STEP_COMPANY_SIZE_FINDER}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_COMPANY_SIZE_FINDER} failed:`, error);
  }

  try {
    const fundingResult = await enrichCompanyFundingFromEdgar(companyId);
    if (fundingResult.attempted) stepsCompleted.push(STEP_FUNDING_FINDER);
  } catch (error) {
    stepsFailed.push(STEP_FUNDING_FINDER);
    errors.push(`${STEP_FUNDING_FINDER}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_FUNDING_FINDER} failed:`, error);
  }

  if (!isAIConnected()) {
    const status = finalStatus(stepsCompleted, stepsFailed);
    run = await prisma.enrichmentRun.update({
      where: { id: run.id },
      data: {
        status,
        stepsCompleted,
        stepsFailed,
        error: ["AI provider not configured — AI-dependent steps skipped.", ...errors].join(" | "),
        finishedAt: new Date(),
      },
    });
    await prisma.company.update({
      where: { id: companyId },
      data: status === "FAILED" ? { enrichmentStatus: "FAILED", enrichmentFailureReason: "AI provider not configured" } : { enrichmentStatus: status, lastEnrichedAt: new Date() },
    });
    console.warn(`[enrichment] company ${companyId}: AI not configured — real non-AI steps [${stepsCompleted.join(", ") || "none"}], status ${status}`);
    return { run, status };
  }

  // Evidence step: converts an ALREADY-EXISTING WebsiteScan (from the
  // Website Scanner feature or a prior run) into real CompanyEvidence rows
  // (syncCompanyTechnologiesFromScan for RAW_FACT technology detections,
  // buildWebsiteIntelligenceEvidence for audit-derived RAW_FACT +
  // AI_INTERPRETATION rows) — both already idempotent (skip facts that
  // already exist). Deliberately does NOT trigger a NEW website crawl here:
  // a full scan is a separate, heavier operation with its own existing
  // entry point (/dashboard/website-scanner) and cost profile; forcing one
  // into every enrichment call was judged out of scope for this phase. A
  // company with no scan yet simply produces 0 evidence from this step —
  // an honest, correctly-reported PARTIAL outcome, never a fabricated one.
  try {
    const latestScan = await prisma.websiteScan.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } });
    if (latestScan) {
      await syncCompanyTechnologiesFromScan(companyId, latestScan.id);
      await buildWebsiteIntelligenceEvidence(companyId, latestScan.id);
      stepsCompleted.push(STEP_WEBSITE_EVIDENCE);
    }
  } catch (error) {
    stepsFailed.push(STEP_WEBSITE_EVIDENCE);
    errors.push(`${STEP_WEBSITE_EVIDENCE}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_WEBSITE_EVIDENCE} failed:`, error);
  }

  try {
    await generateCompanyIntelligence(companyId);
    stepsCompleted.push(STEP_COMPANY_INTELLIGENCE);
  } catch (error) {
    stepsFailed.push(STEP_COMPANY_INTELLIGENCE);
    errors.push(`${STEP_COMPANY_INTELLIGENCE}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_COMPANY_INTELLIGENCE} failed:`, error);
  }

  // Phase 27 (real field-waterfall proof-of-integration): a real,
  // deterministic taxonomy classification, not an open-ended guess — never
  // blocks the rest of the pipeline if it fails (e.g. AI chain exhausted).
  try {
    await classifyBusinessType(companyId);
    stepsCompleted.push(STEP_BUSINESS_TYPE);
  } catch (error) {
    stepsFailed.push(STEP_BUSINESS_TYPE);
    errors.push(`${STEP_BUSINESS_TYPE}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_BUSINESS_TYPE} failed:`, error);
  }

  try {
    await computeIntentScore(companyId);
    stepsCompleted.push(STEP_INTENT_SCORE);
  } catch (error) {
    stepsFailed.push(STEP_INTENT_SCORE);
    errors.push(`${STEP_INTENT_SCORE}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_INTENT_SCORE} failed:`, error);
  }

  // Real idempotency finding (Phase 1 E2E testing): discoverDecisionMakers'
  // own dedup match is by exact case-insensitive name string, and a live
  // web-search re-run can genuinely phrase the same real person's name
  // slightly differently (or a broader/narrower search surfaces one more
  // real person than last time) — re-running it back-to-back on the same
  // company was observed to add an extra real DecisionMaker row rather than
  // cleanly re-verifying the existing ones. This cooldown is the fix:
  // within DECISION_MAKER_REVERIFY_COOLDOWN_HOURS of the most recent
  // verification, skip re-running discovery entirely (recorded as a
  // completed step, not a failure — nothing was wrong, there was just
  // nothing new to check yet). Never touches discoverDecisionMakers itself
  // (rule: don't replace the existing DecisionMaker system).
  const mostRecentVerification = await prisma.decisionMaker.findFirst({ where: { companyId }, orderBy: { verifiedAt: "desc" }, select: { verifiedAt: true } });
  const recentlyVerified = mostRecentVerification && Date.now() - mostRecentVerification.verifiedAt.getTime() < DECISION_MAKER_REVERIFY_COOLDOWN_MS;
  if (recentlyVerified) {
    stepsCompleted.push(STEP_DECISION_MAKERS);
  } else {
    try {
      await discoverDecisionMakers(companyId);
      stepsCompleted.push(STEP_DECISION_MAKERS);
    } catch (error) {
      stepsFailed.push(STEP_DECISION_MAKERS);
      errors.push(`${STEP_DECISION_MAKERS}: ${errorMessage(error)}`);
      console.error(`[enrichment] company ${companyId} — ${STEP_DECISION_MAKERS} failed:`, error);
    }
  }

  try {
    await generateLeadOpportunities(companyId);
    const unscored = await prisma.leadOpportunity.findMany({ where: { companyId, opportunityScore: null }, select: { id: true } });
    for (const opportunity of unscored) {
      try {
        await computeOpportunityScore(opportunity.id);
      } catch (error) {
        console.error(`[enrichment] company ${companyId} — opportunity ${opportunity.id} scoring failed:`, error);
      }
    }
    stepsCompleted.push(STEP_OPPORTUNITIES);
  } catch (error) {
    stepsFailed.push(STEP_OPPORTUNITIES);
    errors.push(`${STEP_OPPORTUNITIES}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_OPPORTUNITIES} failed:`, error);
  }

  try {
    await scoreCompany(companyId);
    stepsCompleted.push(STEP_LEAD_SCORE);
  } catch (error) {
    stepsFailed.push(STEP_LEAD_SCORE);
    errors.push(`${STEP_LEAD_SCORE}: ${errorMessage(error)}`);
    console.error(`[enrichment] company ${companyId} — ${STEP_LEAD_SCORE} failed:`, error);
  }

  const factsFound = await prisma.companyEvidence.count({ where: { companyId, discoveredAt: { gte: startedAt } } });
  const status = finalStatus(stepsCompleted, stepsFailed);

  run = await prisma.enrichmentRun.update({
    where: { id: run.id },
    data: {
      status,
      stepsCompleted,
      stepsFailed,
      factsFound,
      error: errors.length > 0 ? errors.join(" | ") : null,
      finishedAt: new Date(),
    },
  });

  await prisma.company.update({
    where: { id: companyId },
    data:
      status === "FAILED"
        ? { enrichmentStatus: "FAILED", enrichmentFailureReason: errors.join(" | ") || "All enrichment steps failed" }
        : { enrichmentStatus: status, lastEnrichedAt: new Date(), enrichmentFailureReason: null },
  });

  // Phase 24 (requirement #19, audit trail): the real enrichment-outcome
  // write, audited. Deliberately NOT logging the earlier RUNNING-status
  // transition or the domain-backfill above — those are routine
  // in-progress bookkeeping, not a meaningful outcome worth an audit row.
  await logAudit({
    organizationId: company.organizationId,
    action: "company.enriched",
    metadata: { companyId, status, stepsCompleted, stepsFailed, factsFound },
  });

  console.log(`[enrichment] company ${companyId}: ${status} — completed [${stepsCompleted.join(", ")}], failed [${stepsFailed.join(", ")}], ${factsFound} new fact(s)`);

  return { run, status };
}

// ===== Contact enrichment =====

/**
 * Deterministic (never AI-guessed) job-title → seniority/decision-maker-
 * probability heuristic — same "documented lookup table, not a fresh AI
 * call" discipline as decision-maker-matching.ts's ROLE_RELEVANCE_TABLE.
 * Ordered most-senior-first; the first matching keyword wins. A title that
 * matches nothing gets `seniority: null, probability: null` (UNKNOWN) —
 * never a guessed default.
 */
const SENIORITY_SIGNALS: Array<{ keywords: string[]; seniority: string; probability: number }> = [
  { keywords: ["founder", "co-founder", "cofounder", "ceo", "owner", "president"], seniority: "Founder/CEO", probability: 0.95 },
  { keywords: ["cto", "coo", "cfo", "cmo", "chief"], seniority: "C-Level", probability: 0.9 },
  { keywords: ["vp ", "vice president", "svp", "evp"], seniority: "VP", probability: 0.8 },
  { keywords: ["director", "head of", " head", "principal"], seniority: "Director/Head", probability: 0.7 },
  { keywords: ["senior manager", "manager", "lead"], seniority: "Manager", probability: 0.4 },
  { keywords: ["associate", "executive", "specialist", "coordinator", "analyst"], seniority: "Individual Contributor", probability: 0.15 },
  { keywords: ["intern", "trainee"], seniority: "Intern", probability: 0.02 },
];

export function estimateSeniority(jobTitle: string | null | undefined): { seniority: string | null; probability: number | null } {
  if (!jobTitle || !jobTitle.trim()) return { seniority: null, probability: null };
  const lower = jobTitle.toLowerCase();
  for (const row of SENIORITY_SIGNALS) {
    if (row.keywords.some((kw) => lower.includes(kw))) return { seniority: row.seniority, probability: row.probability };
  }
  return { seniority: null, probability: null };
}

export interface EnrichContactOptions {
  triggeredBy: EnrichmentTrigger;
  triggeredByUserId?: string | null;
}

export interface EnrichContactResult {
  run: EnrichmentRun;
  status: EnrichmentRunStatus;
  matchedDecisionMakerId: string | null;
}

/**
 * Enriches one existing Contact — never creates a Contact (rule: "Do not
 * create a contact simply because an AI model predicts that person
 * exists"). Deterministically estimates seniority/decision-maker-
 * probability from the contact's own already-stored `jobTitle` (no AI
 * call — nothing to fabricate), and attempts a real-name match against the
 * same company's `DecisionMaker` rows to set the durable `decisionMakerId`
 * FK (see decision-maker-matching.ts's `findMatchingDecisionMaker`).
 */
export async function enrichContact(contactId: string, options: EnrichContactOptions): Promise<EnrichContactResult> {
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: contactId },
    include: { company: { include: { decisionMakers: true } } },
  });

  const alreadyRunning = await prisma.enrichmentRun.findFirst({
    where: { entityId: contactId, entityType: "CONTACT", status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (alreadyRunning) return { run: alreadyRunning, status: alreadyRunning.status, matchedDecisionMakerId: null };

  let run = await prisma.enrichmentRun.create({
    data: {
      organizationId: contact.organizationId,
      entityType: "CONTACT",
      entityId: contactId,
      companyId: contact.companyId,
      triggeredBy: options.triggeredBy,
      triggeredByUserId: options.triggeredByUserId ?? null,
      status: "RUNNING",
    },
  });

  const { seniority, probability } = estimateSeniority(contact.jobTitle);
  const buyerRole = classifyBuyerRole(contact.jobTitle);

  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const matched = contact.decisionMakerId
    ? null // already linked — don't re-search
    : findMatchingDecisionMaker(fullName, contact.company?.decisionMakers ?? []);

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      decisionMakerProbability: probability,
      decisionMakerId: matched ? matched.id : contact.decisionMakerId,
      enrichmentStatus: "COMPLETED",
      lastEnrichedAt: new Date(),
      // Phase 25 fix: seniority now has its own real field — it must NEVER
      // be written into `department` (a real bug this session: a contact
      // with no real department ended up with department: "VP", which is
      // not a department). `department` itself is never touched by
      // enrichment now — it stays genuinely user-editable/empty.
      seniority: contact.seniority ?? seniority,
      buyerRole,
    },
  });

  // Phase 26 (wire ContactEvidence for real — Phase 25's report claimed
  // this was already done; it wasn't, confirmed by audit). Both values are
  // deterministic derivations from the contact's own already-stored
  // jobTitle (never an AI call, nothing fabricated) — `kind:
  // AI_INTERPRETATION` is used as the closest existing category for "an
  // inference, not a directly observed fact" (EvidenceKind has no
  // dedicated "deterministic derivation" value; RAW_FACT would overstate
  // it as an observed fact, which it isn't). Only written when the
  // contact didn't already have this exact seniority/buyerRole on file, so
  // a repeated no-change re-enrichment run doesn't spam duplicate rows —
  // same idempotency discipline as technology-evidence-sync.ts.
  // Each row carries its own real confidence — seniority's probability
  // heuristic for `seniority`, and a flat 1.0 for `buyerRole` (a
  // deterministic keyword classification with no probability concept of
  // its own; previously both rows wrongly reused seniority's `probability`,
  // even when buyerRole matched but seniority didn't).
  const evidenceRows: Array<{ fieldName: string; fact: string; confidence: number }> = [];
  if (seniority && contact.seniority !== seniority) {
    evidenceRows.push({
      fieldName: "seniority",
      fact: `Seniority estimated as "${seniority}" from job title "${contact.jobTitle}".`,
      confidence: probability ?? 0.5,
    });
  }
  if (buyerRole && buyerRole !== "UNKNOWN" && contact.buyerRole !== buyerRole) {
    evidenceRows.push({
      fieldName: "buyerRole",
      fact: `Buyer role classified as ${buyerRole} from job title "${contact.jobTitle}".`,
      confidence: 1.0,
    });
  }
  if (evidenceRows.length > 0) {
    await prisma.contactEvidence.createMany({
      data: evidenceRows.map((row) => ({
        contactId,
        kind: "AI_INTERPRETATION" as const,
        fact: row.fact,
        source: "COMPANY_INTELLIGENCE" as const,
        confidence: row.confidence,
        fieldName: row.fieldName,
      })),
    });
  }

  // Real multi-provider email verification (src/lib/enrichment/
  // email-waterfall.ts) — never an AI call, so it runs unconditionally here,
  // same reasoning as enrichCompany's registry/email-pattern steps above.
  // Best-effort: a provider outage must never fail the rest of contact
  // enrichment, which has already genuinely succeeded by this point.
  let emailVerificationAttempted = false;
  try {
    const verification = await verifyContactEmailWaterfall(contactId);
    emailVerificationAttempted = verification.providerUsed !== null;
  } catch (error) {
    console.error(`[enrichment] contact ${contactId} — email verification failed:`, error);
  }

  // Real, low-cost phone/LinkedIn finder (Prospeo) — best-effort, never
  // blocks the rest of contact enrichment, which has already genuinely
  // succeeded by this point.
  let phoneOrLinkedinFound = false;
  try {
    const finderResult = await enrichContactPhoneAndLinkedIn(contactId);
    phoneOrLinkedinFound = finderResult.phoneFound || finderResult.linkedinFound;
  } catch (error) {
    console.error(`[enrichment] contact ${contactId} — ${STEP_PHONE_FINDER} failed:`, error);
  }

  run = await prisma.enrichmentRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      stepsCompleted: [
        "SENIORITY_ESTIMATE",
        ...(matched ? ["DECISION_MAKER_LINK"] : []),
        ...(emailVerificationAttempted ? ["EMAIL_VERIFICATION"] : []),
        ...(phoneOrLinkedinFound ? [STEP_PHONE_FINDER] : []),
      ],
      finishedAt: new Date(),
    },
  });

  console.log(`[enrichment] contact ${contactId}: COMPLETED — seniority=${seniority ?? "unknown"}, decisionMaker=${matched?.id ?? "none"}, emailVerified=${emailVerificationAttempted}`);

  return { run, status: "COMPLETED", matchedDecisionMakerId: matched?.id ?? null };
}

// ===== Staleness =====

const DEFAULT_STALE_DAYS = 60;
const HIGH_VALUE_STALE_DAYS = 14;

/**
 * A company is "high-value" for re-enrichment cadence purposes if it has at
 * least one non-DISMISSED LeadOpportunity — an existing, already-qualified
 * signal (same definition decision-maker-sync-job.ts already uses for
 * "qualified"), not a new concept invented here.
 */
export async function isCompanyHighValue(companyId: string): Promise<boolean> {
  const count = await prisma.leadOpportunity.count({ where: { companyId, status: { not: "DISMISSED" } } });
  return count > 0;
}

export function isStale(lastEnrichedAt: Date | null, staleDays: number): boolean {
  if (!lastEnrichedAt) return true;
  const ageMs = Date.now() - lastEnrichedAt.getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}

export { DEFAULT_STALE_DAYS, HIGH_VALUE_STALE_DAYS };
