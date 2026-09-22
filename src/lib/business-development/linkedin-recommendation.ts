import { prisma } from "@/lib/prisma";
import { getIntentRecommendedAction } from "./intent-recommendation";

/**
 * Phase 9 (LinkedIn Sales Intelligence) §18-22/§43 — the AI Recommendation
 * Engine (WHO/WHY/WHEN/MESSAGE ANGLE). Deliberately NOT a new scoring/
 * matching system: it wraps Phase 2's existing `getIntentRecommendedAction`
 * (itself a pure composer over the real, already-persisted
 * DecisionMaker-matching + Opportunity-brief output — no new AI call here)
 * and adds only the one genuinely new piece, WHEN, computed from real
 * outreach-history timestamps across every real channel this app has
 * (Email/WhatsApp/LinkedIn — all live in the same EmailDraft/Reply tables).
 *
 * This runs identically regardless of whether a real LinkedIn integration
 * is connected (see linkedin-capabilities.ts) — its evidence is real
 * GrowthOS CRM data (Company/Contact/DecisionMaker/Intent/Opportunity/
 * Conversation), NEVER LinkedIn member data this app has no access to.
 * `channel: "LINKEDIN"` on the recommendation means "this is what to say
 * if you reach out on LinkedIn", not "this data came from LinkedIn".
 *
 * §43: every field maps to the spec's exact required format, and
 * `status: "RECOMMENDATION_ONLY"` is always present — this function never
 * executes anything, only recommends.
 */

// Judgment call, documented: 3 real days of silence across every channel is
// long enough that a fresh outreach attempt reads as a genuine follow-up
// rather than a repeat ping — the same order of magnitude as this
// codebase's other real cooldown/reminder thresholds (e.g.
// LINKEDIN_REMINDER_THRESHOLD_DAYS=2 in scheduler/registry.ts).
const OUTREACH_COOLDOWN_DAYS = 3;

export type LinkedInRecommendationConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface LinkedInRecommendationEvidence {
  recordType: string;
  recordId: string;
  description: string;
}

export interface LinkedInOutreachRecommendation {
  hasRecommendation: boolean;
  who: { contactId: string; name: string; role: string; isDecisionMaker: true } | null;
  why: string;
  when: { recommendation: "NOW" | "WAIT"; reason: string; waitUntil: string | null };
  messageAngle: string | null;
  evidence: LinkedInRecommendationEvidence[];
  confidence: LinkedInRecommendationConfidence;
  status: "RECOMMENDATION_ONLY";
}

function confidenceFromScore(score: number | null): LinkedInRecommendationConfidence {
  if (score === null) return "UNKNOWN";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export async function getLinkedInOutreachRecommendation(organizationId: string, companyId: string): Promise<LinkedInOutreachRecommendation> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.organizationId !== organizationId) {
    return {
      hasRecommendation: false,
      who: null,
      why: "Company not found.",
      when: { recommendation: "WAIT", reason: "No real company record to recommend against.", waitUntil: null },
      messageAngle: null,
      evidence: [],
      confidence: "UNKNOWN",
      status: "RECOMMENDATION_ONLY",
    };
  }

  const action = await getIntentRecommendedAction(companyId);
  if (!action.hasRecommendation || !action.decisionMaker) {
    return {
      hasRecommendation: false,
      who: null,
      why: action.summary,
      when: { recommendation: "WAIT", reason: "No real, verified decision-maker matched to a qualified opportunity yet.", waitUntil: null },
      messageAngle: null,
      evidence: [],
      confidence: "UNKNOWN",
      status: "RECOMMENDATION_ONLY",
    };
  }

  const dm = action.decisionMaker.decisionMaker;
  const contact = await prisma.contact.findFirst({ where: { organizationId, companyId, decisionMakerId: dm.id } });

  const evidence: LinkedInRecommendationEvidence[] = [];
  if (action.opportunityId) evidence.push({ recordType: "LeadOpportunity", recordId: action.opportunityId, description: action.brief?.evidence ?? "Real detected opportunity for this company." });
  evidence.push({ recordType: "DecisionMaker", recordId: dm.id, description: `${dm.name} — ${dm.role.replaceAll("_", " ").toLowerCase()}. ${action.decisionMaker.whyThisPerson}` });

  const intentScore = await prisma.intentScore.findUnique({ where: { companyId } });
  if (intentScore) evidence.push({ recordType: "IntentScore", recordId: intentScore.id, description: `Buying-intent band ${intentScore.band}: ${intentScore.reasoning}` });

  // WHEN — real last-contact timestamp across every real channel this app
  // has (Email/WhatsApp/LinkedIn all share EmailDraft/Reply), never a
  // LinkedIn-specific signal this app has no access to.
  const [lastOutbound, lastInbound] = await Promise.all([
    contact ? prisma.emailDraft.findFirst({ where: { organizationId, contactId: contact.id, status: { in: ["SENT", "DELIVERED", "READ"] } }, orderBy: { sentAt: "desc" } }) : null,
    contact ? prisma.reply.findFirst({ where: { organizationId, contactId: contact.id }, orderBy: { receivedAt: "desc" } }) : null,
  ]);
  const lastContactAt = [lastOutbound?.sentAt, lastInbound?.receivedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  let when: LinkedInOutreachRecommendation["when"];
  if (!lastContactAt) {
    when = { recommendation: "NOW", reason: "No prior real outreach found on any channel — no cooldown applies.", waitUntil: null };
  } else {
    const daysSince = (Date.now() - lastContactAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince >= OUTREACH_COOLDOWN_DAYS) {
      when = { recommendation: "NOW", reason: `Last real contact was ${Math.floor(daysSince)} day(s) ago — past the ${OUTREACH_COOLDOWN_DAYS}-day cooldown.`, waitUntil: null };
    } else {
      const waitUntil = new Date(lastContactAt.getTime() + OUTREACH_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      when = { recommendation: "WAIT", reason: `Contacted ${Math.floor(daysSince)} day(s) ago — within the ${OUTREACH_COOLDOWN_DAYS}-day cooldown.`, waitUntil: waitUntil.toISOString() };
    }
  }
  if (lastOutbound) evidence.push({ recordType: "EmailDraft", recordId: lastOutbound.id, description: `Last real outbound contact, ${lastOutbound.channel}, ${lastOutbound.sentAt?.toISOString()}.` });
  if (lastInbound) evidence.push({ recordType: "Reply", recordId: lastInbound.id, description: `Last real inbound reply, ${lastInbound.channel}, ${lastInbound.receivedAt.toISOString()}.` });

  return {
    hasRecommendation: true,
    who: contact ? { contactId: contact.id, name: `${contact.firstName} ${contact.lastName ?? ""}`.trim(), role: dm.role, isDecisionMaker: true } : null,
    why: action.brief?.whyThisService ?? action.summary,
    when,
    messageAngle: action.brief?.recommendedSalesAngle ?? action.brief?.recommendedNextStep ?? null,
    evidence,
    confidence: confidenceFromScore(action.brief?.serviceMatchScore ?? null),
    status: "RECOMMENDATION_ONLY",
  };
}
