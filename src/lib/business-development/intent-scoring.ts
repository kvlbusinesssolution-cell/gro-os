import { prisma } from "@/lib/prisma";
import type { IntentBand, BuyingStage, Prisma } from "@/generated/prisma/client";

/**
 * Intent Score — Phase 4, factor #2 of 3 ("How strong is the evidence the
 * company may need something NOW?"). Deliberately SEPARATE from LeadScore
 * (relevance/fit — src/lib/lead-scoring.ts, reused as-is, never recomputed
 * here) and from LeadOpportunity.opportunityScore
 * (src/lib/business-development/opportunity-priority.ts).
 *
 * PURE DETERMINISTIC COMPUTATION — no AI call. The inputs are already real,
 * already-AI-generated/measured data: CompanyIntelligence's growthSignals /
 * hiringSignals / expansionIndicators arrays (Phase 1, always labeled
 * "AI-generated" in the UI, never presented as verified fact upstream — we
 * simply count what's already there) plus CompanyEvidence RAW_FACT rows
 * that indicate a real, measured website problem (Phase 1's
 * website-intelligence.ts — e.g. "Performance score: 42/100").
 *
 * "No signal should be treated as intent without evidence": a company with
 * no CompanyIntelligence run and no CompanyEvidence rows scores exactly 0,
 * band NONE, with an honest reasoning sentence saying so — never padded.
 */

export interface IntentSignal {
  signal: string;
  source:
    | "growthSignals"
    | "hiringSignals"
    | "expansionIndicators"
    | "companyEvidence"
    // Phase 2 (Buying Intent Intelligence Engine) — real CRM/outreach
    // engagement, read directly from EmailDraft/Reply/OutreachMeeting/
    // Proposal (the same real tables company-complete-timeline.ts already
    // reads for its display timeline — reused here for scoring, not
    // duplicated as a second event-log concept).
    | "emailEngagement"
    | "replyEngagement"
    | "meetingActivity"
    | "proposalActivity";
  detail: string;
  points: number;
}

export interface IntentScoreComputation {
  score: number;
  band: IntentBand;
  signals: IntentSignal[];
  reasoning: string;
  buyingStage: BuyingStage;
  buyingStageReasoning: string;
  buyingStageConfidence: number;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ----- Documented point weights -----
// Each entry in a CompanyIntelligence signal list represents one real,
// already-AI-extracted observation. Weighted by how directly each signal
// type implies imminent buying intent (hiring/expansion are closer to "may
// need something now" than a general growth mention), and capped per
// category so one long, repetitive AI list can't dominate the whole score.
const GROWTH_SIGNAL_POINTS = 8;
const GROWTH_SIGNAL_CAP = 32; // max 4 signals counted
const HIRING_SIGNAL_POINTS = 10;
const HIRING_SIGNAL_CAP = 30; // max 3 signals counted
const EXPANSION_SIGNAL_POINTS = 12;
const EXPANSION_SIGNAL_CAP = 36; // max 3 signals counted
const EVIDENCE_PROBLEM_POINTS = 6;
const EVIDENCE_PROBLEM_CAP = 24; // max 4 facts counted

// A website-intelligence RAW_FACT audit sub-score below this threshold
// counts as a real, measured problem (not a guess — the score itself is a
// deterministic measurement from src/lib/scanner/).
const POOR_SCORE_THRESHOLD = 50;

// Recency bonus/decay: a signal tied to intelligence/evidence gathered very
// recently (last 14 days) is more likely to still reflect the company's
// CURRENT situation than one from months ago — hiring pages get filled,
// website issues get fixed. Documented as a flat +10 bonus on top of the
// summed signal points when the *latest* CompanyIntelligence run (or, if
// none, the most recent CompanyEvidence row) is within the window; no
// penalty is applied for older data beyond simply not getting the bonus
// (we still trust older-but-real signals, just slightly less).
const RECENCY_WINDOW_DAYS = 14;
const RECENCY_BONUS = 10;

// ===== Phase 2 (Buying Intent Intelligence Engine): real CRM/outreach =====
// engagement signals — added alongside (never replacing) the AI-research
// signals above. Read directly from EmailDraft/Reply/OutreachMeeting/
// Proposal, the same real tables company-complete-timeline.ts already
// queries for its display timeline (reused here for scoring; not a second
// event-log concept). Every point value below is a documented constant,
// never a scattered magic number.

// Reply intent → points. Ranked by how directly the reply signals real
// buying intent (spec's own example: "reply requesting pricing may be
// stronger than email opened once") — a plain positive reply earns less
// than an explicit pricing/proposal/call request. Replies that indicate
// disinterest (NOT_INTERESTED, WRONG_CONTACT, OUT_OF_OFFICE, UNSUBSCRIBE)
// or carry no real signal (UNKNOWN, null) earn 0 — never negative, per
// "do not create fake intent" (there's no evidence base to justify a
// penalty, only an absence of positive evidence).
const REPLY_INTENT_POINTS: Partial<Record<string, number>> = {
  PRICE_QUESTION: 15,
  REQUEST_PROPOSAL: 15,
  REQUEST_CALL: 12,
  INTERESTED: 8,
  NEEDS_INFORMATION: 4,
  FOLLOW_UP_LATER: 4,
};
const REPLY_SIGNAL_CAP = 30; // max ~2 strong replies counted

// A real, measurably-opened/clicked email is weaker evidence than a reply —
// "do not treat every open as buying intent" (spec, verbatim) — so this is
// deliberately the smallest per-event weight of any new signal type.
const EMAIL_OPEN_POINTS = 3;
const EMAIL_CLICK_BONUS = 2;
const EMAIL_ENGAGEMENT_CAP = 15;

const MEETING_REQUESTED_POINTS = 15;
const MEETING_SIGNAL_CAP = 30; // max 2 meetings counted

const PROPOSAL_SENT_POINTS = 15;
const PROPOSAL_ACCEPTED_POINTS = 25;
const PROPOSAL_SIGNAL_CAP = 30;

/**
 * Per-signal-type freshness/decay — distinct from the flat
 * RECENCY_BONUS above (which stays untouched, applying only to the
 * pre-existing AI-research signals). Each new engagement signal type keeps
 * full weight until `fullWeightDays`, then linearly tapers to `floorMultiplier`
 * by `floorDays`, then stays at that floor — never truly zero ("older signal
 * → weaker... expired signal → no longer contributes or contributes
 * minimally", spec verbatim; historical evidence itself is never deleted,
 * only its CURRENT contribution shrinks). Documented thresholds per the
 * spec's own worked examples: replies/email opens are closer to
 * "breaking-news short-lived", meetings sit in the middle, and an
 * open/SENT proposal — still an active opportunity — decays the slowest.
 */
interface DecayProfile {
  fullWeightDays: number;
  floorDays: number;
  floorMultiplier: number;
}
const REPLY_DECAY: DecayProfile = { fullWeightDays: 7, floorDays: 30, floorMultiplier: 0.2 };
const EMAIL_ENGAGEMENT_DECAY: DecayProfile = { fullWeightDays: 7, floorDays: 21, floorMultiplier: 0.15 };
const MEETING_DECAY: DecayProfile = { fullWeightDays: 14, floorDays: 45, floorMultiplier: 0.3 };
const PROPOSAL_DECAY: DecayProfile = { fullWeightDays: 30, floorDays: 90, floorMultiplier: 0.4 };

function decayMultiplier(ageDays: number, profile: DecayProfile): number {
  if (ageDays <= profile.fullWeightDays) return 1;
  if (ageDays >= profile.floorDays) return profile.floorMultiplier;
  const span = profile.floorDays - profile.fullWeightDays;
  const progress = (ageDays - profile.fullWeightDays) / span;
  return 1 - progress * (1 - profile.floorMultiplier);
}

function ageInDays(date: Date): number {
  return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
}

const THRESHOLDS = { HIGH: 70, MEDIUM: 40, LOW: 15 } as const;

function bandFor(score: number): IntentBand {
  if (score >= THRESHOLDS.HIGH) return "HIGH";
  if (score >= THRESHOLDS.MEDIUM) return "MEDIUM";
  if (score >= THRESHOLDS.LOW) return "LOW";
  return "NONE";
}

function extractAuditScore(fact: string): number | null {
  const match = fact.match(/^(SEO|Performance|UX|Security) score: (\d+)\/100$/);
  if (!match) return null;
  return Number(match[2]);
}

function isDaysAgo(date: Date, days: number): boolean {
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

export async function computeIntentScore(companyId: string): Promise<IntentScoreComputation | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return null;

  const latestIntel = await prisma.companyIntelligence.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  const evidenceRows = await prisma.companyEvidence.findMany({
    where: { companyId, kind: "RAW_FACT" },
    orderBy: { discoveredAt: "desc" },
  });

  const signals: IntentSignal[] = [];

  if (latestIntel) {
    let growthPoints = 0;
    for (const s of latestIntel.growthSignals) {
      if (growthPoints >= GROWTH_SIGNAL_CAP) break;
      const points = Math.min(GROWTH_SIGNAL_POINTS, GROWTH_SIGNAL_CAP - growthPoints);
      growthPoints += points;
      signals.push({ signal: "Growth signal", source: "growthSignals", detail: s, points });
    }

    let hiringPoints = 0;
    for (const s of latestIntel.hiringSignals) {
      if (hiringPoints >= HIRING_SIGNAL_CAP) break;
      const points = Math.min(HIRING_SIGNAL_POINTS, HIRING_SIGNAL_CAP - hiringPoints);
      hiringPoints += points;
      signals.push({ signal: "Hiring signal", source: "hiringSignals", detail: s, points });
    }

    let expansionPoints = 0;
    for (const s of latestIntel.expansionIndicators) {
      if (expansionPoints >= EXPANSION_SIGNAL_CAP) break;
      const points = Math.min(EXPANSION_SIGNAL_POINTS, EXPANSION_SIGNAL_CAP - expansionPoints);
      expansionPoints += points;
      signals.push({ signal: "Expansion indicator", source: "expansionIndicators", detail: s, points });
    }
  }

  let evidencePoints = 0;
  for (const e of evidenceRows) {
    if (evidencePoints >= EVIDENCE_PROBLEM_CAP) break;
    const auditScore = extractAuditScore(e.fact);
    if (auditScore === null || auditScore >= POOR_SCORE_THRESHOLD) continue;
    const points = Math.min(EVIDENCE_PROBLEM_POINTS, EVIDENCE_PROBLEM_CAP - evidencePoints);
    evidencePoints += points;
    signals.push({ signal: "Website problem evidence", source: "companyEvidence", detail: e.fact, points });
  }

  // ===== Phase 2: real CRM/outreach engagement signals =====
  const contacts = await prisma.contact.findMany({ where: { companyId }, select: { id: true } });
  const contactIds = contacts.map((c) => c.id);

  const [replies, emailDrafts, meetings, proposals] = await Promise.all([
    contactIds.length > 0
      ? prisma.reply.findMany({ where: { contactId: { in: contactIds } }, orderBy: { receivedAt: "desc" } })
      : [],
    contactIds.length > 0
      ? prisma.emailDraft.findMany({ where: { contactId: { in: contactIds }, firstOpenedAt: { not: null } }, orderBy: { firstOpenedAt: "desc" } })
      : [],
    contactIds.length > 0 ? prisma.outreachMeeting.findMany({ where: { contactId: { in: contactIds } }, orderBy: { createdAt: "desc" } }) : [],
    prisma.proposal.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
  ]);

  let replyPoints = 0;
  for (const r of replies) {
    if (replyPoints >= REPLY_SIGNAL_CAP) break;
    const basePoints = (r.intent && REPLY_INTENT_POINTS[r.intent]) ?? 0;
    if (basePoints === 0) continue; // no positive evidence in this reply — never a fabricated signal
    const points = Math.round(Math.min(basePoints, REPLY_SIGNAL_CAP - replyPoints) * decayMultiplier(ageInDays(r.receivedAt), REPLY_DECAY));
    if (points <= 0) continue;
    replyPoints += points;
    signals.push({ signal: "Reply engagement", source: "replyEngagement", detail: `Reply classified ${r.intent}${r.sentiment ? ` (${r.sentiment.toLowerCase()})` : ""}`, points });
  }

  let emailEngagementPoints = 0;
  for (const draft of emailDrafts) {
    if (emailEngagementPoints >= EMAIL_ENGAGEMENT_CAP) break;
    if (!draft.firstOpenedAt) continue;
    const basePoints = EMAIL_OPEN_POINTS + (draft.firstClickedAt ? EMAIL_CLICK_BONUS : 0);
    const points = Math.round(Math.min(basePoints, EMAIL_ENGAGEMENT_CAP - emailEngagementPoints) * decayMultiplier(ageInDays(draft.firstOpenedAt), EMAIL_ENGAGEMENT_DECAY));
    if (points <= 0) continue;
    emailEngagementPoints += points;
    signals.push({
      signal: "Email engagement",
      source: "emailEngagement",
      detail: draft.firstClickedAt ? `Email opened and a link was clicked (opened ${draft.openCount}x)` : `Email opened (${draft.openCount}x)`,
      points,
    });
  }

  let meetingPoints = 0;
  for (const m of meetings) {
    if (meetingPoints >= MEETING_SIGNAL_CAP) break;
    const points = Math.round(Math.min(MEETING_REQUESTED_POINTS, MEETING_SIGNAL_CAP - meetingPoints) * decayMultiplier(ageInDays(m.createdAt), MEETING_DECAY));
    if (points <= 0) continue;
    meetingPoints += points;
    signals.push({ signal: "Meeting activity", source: "meetingActivity", detail: `Meeting "${m.title}" (${m.status.toLowerCase()})`, points });
  }

  let proposalPoints = 0;
  for (const p of proposals) {
    if (proposalPoints >= PROPOSAL_SIGNAL_CAP) break;
    const basePoints = p.status === "ACCEPTED" ? PROPOSAL_ACCEPTED_POINTS : p.status === "SENT" ? PROPOSAL_SENT_POINTS : 0;
    if (basePoints === 0) continue; // DRAFT/REJECTED carry no current positive intent evidence
    const points = Math.round(Math.min(basePoints, PROPOSAL_SIGNAL_CAP - proposalPoints) * decayMultiplier(ageInDays(p.createdAt), PROPOSAL_DECAY));
    if (points <= 0) continue;
    proposalPoints += points;
    signals.push({ signal: "Proposal activity", source: "proposalActivity", detail: `Proposal "${p.title}" is ${p.status}`, points });
  }

  let subtotal = signals.reduce((sum, s) => sum + s.points, 0);

  // Recency bonus — only applied (once) when there's at least one real
  // signal to begin with, and only when the freshest source of those
  // signals falls inside the recency window.
  let recencyApplied = false;
  if (subtotal > 0) {
    const freshDates = [latestIntel?.createdAt, evidenceRows[0]?.discoveredAt].filter((d): d is Date => Boolean(d));
    const isFresh = freshDates.some((d) => isDaysAgo(d, RECENCY_WINDOW_DAYS));
    if (isFresh) {
      recencyApplied = true;
      subtotal += RECENCY_BONUS;
      signals.push({
        signal: "Recency bonus",
        source: latestIntel && isDaysAgo(latestIntel.createdAt, RECENCY_WINDOW_DAYS) ? "growthSignals" : "companyEvidence",
        detail: `Underlying signal data is within the last ${RECENCY_WINDOW_DAYS} days`,
        points: RECENCY_BONUS,
      });
    }
  }

  const score = clamp(subtotal);
  const band = bandFor(score);

  const reasoning =
    signals.length === 0
      ? "No buying-intent signals found — no growth/hiring/expansion signals in the latest company intelligence, no website-problem evidence, and no real reply/email/meeting/proposal engagement on record. Intent score is 0 (NONE)."
      : `Intent score ${score} (${band}), based on ${signals.length} real signal${signals.length === 1 ? "" : "s"}: ${signals
          .filter((s) => s.signal !== "Recency bonus")
          .map((s) => `${s.signal.toLowerCase()} ("${s.detail}", +${s.points})`)
          .join("; ")}${recencyApplied ? `; plus a +${RECENCY_BONUS} recency bonus since the underlying data is within the last ${RECENCY_WINDOW_DAYS} days.` : "."}`;

  const { buyingStage, buyingStageReasoning, buyingStageConfidence } = await classifyBuyingStage(companyId, { replies, proposals, meetings, emailDrafts });

  const result: IntentScoreComputation = { score, band, signals, reasoning, buyingStage, buyingStageReasoning, buyingStageConfidence };

  const existing = await prisma.intentScore.findUnique({ where: { companyId } });

  await prisma.intentScore.upsert({
    where: { companyId },
    create: { companyId, score, band, signals: signals as unknown as Prisma.InputJsonValue, reasoning, buyingStage, buyingStageReasoning, buyingStageConfidence },
    update: { score, band, signals: signals as unknown as Prisma.InputJsonValue, reasoning, scoredAt: new Date(), buyingStage, buyingStageReasoning, buyingStageConfidence },
  });

  // Phase 2: append-only history — only when something genuinely changed
  // (never on a no-op recompute, so this never grows into log noise; never
  // overwrites a prior row).
  const scoreChanged = !existing || existing.score !== score;
  const bandChanged = !existing || existing.band !== band;
  const stageChanged = !existing || existing.buyingStage !== buyingStage;
  if (scoreChanged || bandChanged || stageChanged) {
    const strongestSignal = [...signals].sort((a, b) => b.points - a.points)[0];
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { organizationId: true } });
    if (company) {
      await prisma.intentScoreHistory.create({
        data: {
          organizationId: company.organizationId,
          companyId,
          previousScore: existing?.score ?? null,
          newScore: score,
          scoreChange: score - (existing?.score ?? 0),
          previousBand: existing?.band ?? null,
          newBand: band,
          previousStage: existing?.buyingStage ?? null,
          newStage: buyingStage,
          reason: existing
            ? `Score ${existing.score >= score ? "changed" : "increased"} from ${existing.score} to ${score}${bandChanged ? ` (band ${existing.band} → ${band})` : ""}${stageChanged ? ` (stage ${existing.buyingStage} → ${buyingStage})` : ""}.`
            : `Initial intent computation: score ${score} (${band}), stage ${buyingStage}.`,
          triggerSignal: strongestSignal ? `${strongestSignal.signal}: ${strongestSignal.detail}` : null,
        },
      });
    }
  }

  return result;
}

interface BuyingStageInputs {
  replies: Array<{ intent: string | null; sentiment: string | null }>;
  proposals: Array<{ status: string; title: string }>;
  meetings: Array<{ status: string; title: string }>;
  emailDrafts: Array<{ firstOpenedAt: Date | null; openCount: number }>;
}

/**
 * Deterministic, rule-based buying-stage classification — NEVER derived from
 * the intent score number alone ("do not classify a company as DECISION
 * merely because its intent score is high", spec verbatim). Each branch
 * below cites the SPECIFIC real evidence it found; the order matters (most
 * certain/late-funnel outcomes checked first, since e.g. a CUSTOMER can
 * still have old email-open signals that would otherwise look like
 * AWARENESS).
 */
async function classifyBuyingStage(
  companyId: string,
  inputs: BuyingStageInputs,
): Promise<{ buyingStage: BuyingStage; buyingStageReasoning: string; buyingStageConfidence: number }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { status: true } });
  const deals = await prisma.deal.findMany({ where: { companyId }, include: { dealStage: { select: { name: true } } } });
  const hasOpenOpportunity = (await prisma.leadOpportunity.count({ where: { companyId, status: { not: "DISMISSED" } } })) > 0;

  const wonDeal = deals.find((d) => d.dealStage.name === "Won");
  const lostDeal = deals.find((d) => d.lostReason);
  const activeDeal = deals.find((d) => d.dealStage.name !== "Won" && !d.lostReason);

  if (company?.status === "CLIENT" || wonDeal) {
    return {
      buyingStage: "CUSTOMER",
      buyingStageConfidence: 0.95,
      buyingStageReasoning: wonDeal
        ? `Deal "${wonDeal.name}" is in the Won stage.`
        : "Company status is CLIENT.",
    };
  }

  if (company?.status === "CHURNED" || lostDeal) {
    return {
      buyingStage: "LOST",
      buyingStageConfidence: 0.9,
      buyingStageReasoning: lostDeal
        ? `Deal "${lostDeal.name}" was lost${lostDeal.lostReason ? ` (${lostDeal.lostReason})` : ""}.`
        : "Company status is CHURNED.",
    };
  }

  const sentProposal = inputs.proposals.find((p) => p.status === "SENT");
  const strongReplyIntent = inputs.replies.find((r) => r.intent === "PRICE_QUESTION" || r.intent === "REQUEST_PROPOSAL");
  if (activeDeal && (sentProposal || strongReplyIntent)) {
    return {
      buyingStage: "NEGOTIATION",
      buyingStageConfidence: 0.8,
      buyingStageReasoning: `An active deal "${activeDeal.name}" exists alongside ${
        sentProposal ? `a sent proposal ("${sentProposal.title}")` : `a reply requesting ${strongReplyIntent?.intent === "PRICE_QUESTION" ? "pricing" : "a proposal"}`
      }.`,
    };
  }

  const anyProposal = inputs.proposals[0];
  const requestCallReply = inputs.replies.find((r) => r.intent === "REQUEST_CALL" || r.intent === "REQUEST_PROPOSAL");
  const anyMeeting = inputs.meetings[0];
  if (anyProposal || requestCallReply || anyMeeting) {
    return {
      buyingStage: "DECISION",
      buyingStageConfidence: 0.75,
      buyingStageReasoning: anyProposal
        ? `A proposal ("${anyProposal.title}", status ${anyProposal.status}) exists for this company.`
        : anyMeeting
          ? `A meeting ("${anyMeeting.title}", ${anyMeeting.status.toLowerCase()}) has been requested.`
          : `A reply requested ${requestCallReply?.intent === "REQUEST_CALL" ? "a call" : "a proposal"}.`,
    };
  }

  const positiveReply = inputs.replies.find((r) => r.sentiment === "POSITIVE" || r.sentiment === "NEUTRAL");
  const multipleOpens = inputs.emailDrafts.filter((d) => d.firstOpenedAt).length >= 2;
  if (positiveReply || multipleOpens) {
    return {
      buyingStage: "CONSIDERATION",
      buyingStageConfidence: 0.6,
      buyingStageReasoning: positiveReply
        ? `A reply was received with ${positiveReply.sentiment?.toLowerCase()} sentiment.`
        : `Multiple sent emails have been opened.`,
    };
  }

  const anyEmailSent = inputs.emailDrafts.length > 0;
  if (anyEmailSent) {
    return {
      buyingStage: "AWARENESS",
      buyingStageConfidence: 0.5,
      buyingStageReasoning: "At least one outreach email has been sent and opened, but no reply, meeting, or proposal activity yet.",
    };
  }

  if (hasOpenOpportunity) {
    return {
      buyingStage: "TARGET",
      buyingStageConfidence: 0.4,
      buyingStageReasoning: "A real opportunity has been detected for this company, but no outreach touch has happened yet.",
    };
  }

  return {
    buyingStage: "UNKNOWN",
    buyingStageConfidence: 0,
    buyingStageReasoning: "No CRM, outreach, or opportunity evidence exists yet to classify a buying stage.",
  };
}
