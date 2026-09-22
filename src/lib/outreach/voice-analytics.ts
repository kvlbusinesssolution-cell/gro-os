import { prisma } from "@/lib/prisma";

/**
 * Phase 10 (AI Voice Sales Engine) §41 — real counts only, every
 * denominator documented, `null` (rendered "NOT AVAILABLE") whenever a
 * rate would divide by zero. No estimated/fabricated numbers. Cost
 * analytics (§42) are intentionally omitted — this app has no real
 * per-call Twilio billing lookup wired up, so rather than invent a cost
 * figure, cost fields are left absent entirely (an absent field is
 * honest; a fabricated $0.00 is not).
 */
export interface VoiceAnalytics {
  callsPlaced: number;
  answered: number;
  noAnswer: number;
  busy: number;
  voicemail: number;
  interested: number;
  qualified: number;
  meetingsRequested: number;
  blockedByEligibility: number;
  answerRate: number | null;
  interestRate: number | null;
  qualificationRate: number | null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export async function getVoiceAnalytics(organizationId: string): Promise<VoiceAnalytics> {
  const [callsPlaced, answered, noAnswer, busy, voicemail, interested, qualified, meetingsRequested, blockedByEligibility] = await Promise.all([
    prisma.call.count({ where: { organizationId, status: { not: "CANCELLED" } } }),
    prisma.call.count({ where: { organizationId, status: { in: ["ANSWERED", "COMPLETED"] } } }),
    prisma.call.count({ where: { organizationId, status: "NO_ANSWER" } }),
    prisma.call.count({ where: { organizationId, status: "BUSY" } }),
    prisma.call.count({ where: { organizationId, status: "VOICEMAIL" } }),
    prisma.call.count({ where: { organizationId, outcome: "INTERESTED" } }),
    prisma.call.count({ where: { organizationId, outcome: "QUALIFIED" } }),
    prisma.call.count({ where: { organizationId, outcome: "MEETING_REQUESTED" } }),
    prisma.call.count({ where: { organizationId, status: "CANCELLED" } }),
  ]);

  return {
    callsPlaced,
    answered,
    noAnswer,
    busy,
    voicemail,
    interested,
    qualified,
    meetingsRequested,
    blockedByEligibility,
    answerRate: rate(answered, callsPlaced),
    interestRate: rate(interested, answered),
    qualificationRate: rate(qualified, answered),
  };
}
