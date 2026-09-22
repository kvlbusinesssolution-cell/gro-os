"use server";

/**
 * Phase 22 (Career Learning + Job Market Intelligence) — read-only server
 * actions for the /dashboard/career/insights page, plus the one real
 * mutation this phase adds (generating a career recommendation on demand).
 * Every function checks real ownership (userId + organizationId) before
 * returning any data — a career profile is the individual user's, never
 * merely organization-visible (same discipline as every other career
 * action file this session).
 */

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  getCareerOutcomeFunnel,
  getResumePerformance,
  getSkillOutcomeAssociation,
  getChannelPerformance,
  getJobSourcePerformance,
  getRolePerformance,
  getCompanyPerformance,
  getRejectionReasons,
} from "@/lib/career/outcome-analytics";
import { computeJobMarketSnapshot } from "@/lib/career/market-intelligence";
import { getSkillGapAnalysis } from "@/lib/career/skill-gap-analysis";
import {
  whatShouldIApplyToday,
  whatNeedsFollowUp,
  whoReplied,
  whatInterviewsAreUpcoming,
  whatSkillsAreInDemand,
  whatSkillsAmIMissing,
  whichCvPerformsBetter,
} from "@/lib/career/career-insights";
import { generateCvVersionRecommendation, proposeCareerRecommendation } from "@/lib/career/career-recommendations";

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveOwnedProfile(userId: string, organizationId: string, careerProfileId: string) {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return null;
  return profile;
}

export type TimePeriod = "TODAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" | "ALL_TIME";

/** §37 — every dashboard metric must respect the selected period; this is the ONE place that resolves a period label into a real `since` cutoff. Not exported — "use server" files require every top-level export to be an async function; this is an internal-only pure helper. */
function resolveSince(period: TimePeriod): Date | undefined {
  const now = Date.now();
  switch (period) {
    case "TODAY":
      return new Date(new Date().setHours(0, 0, 0, 0));
    case "LAST_7_DAYS":
      return new Date(now - 7 * 86_400_000);
    case "LAST_30_DAYS":
      return new Date(now - 30 * 86_400_000);
    case "LAST_90_DAYS":
      return new Date(now - 90 * 86_400_000);
    case "ALL_TIME":
      return undefined;
  }
}

export interface CareerAnalyticsPayload {
  ok: true;
  period: TimePeriod;
  funnel: Awaited<ReturnType<typeof getCareerOutcomeFunnel>>;
  resumePerformance: Awaited<ReturnType<typeof getResumePerformance>>;
  skillAssociation: Awaited<ReturnType<typeof getSkillOutcomeAssociation>>;
  channelPerformance: Awaited<ReturnType<typeof getChannelPerformance>>;
  sourcePerformance: Awaited<ReturnType<typeof getJobSourcePerformance>>;
  rolePerformance: Awaited<ReturnType<typeof getRolePerformance>>;
  companyPerformance: Awaited<ReturnType<typeof getCompanyPerformance>>;
  rejectionReasons: Awaited<ReturnType<typeof getRejectionReasons>>;
  skillGaps: Awaited<ReturnType<typeof getSkillGapAnalysis>>;
}

export async function getCareerAnalytics(careerProfileId: string, period: TimePeriod = "ALL_TIME"): Promise<CareerAnalyticsPayload | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const since = resolveSince(period);
  const organizationId = membership.organizationId;

  const [funnel, resumePerformance, skillAssociation, channelPerformance, sourcePerformance, rolePerformance, companyPerformance, rejectionReasons, skillGaps] = await Promise.all([
    getCareerOutcomeFunnel(organizationId, careerProfileId, since),
    getResumePerformance(organizationId, careerProfileId),
    getSkillOutcomeAssociation(organizationId, careerProfileId),
    getChannelPerformance(organizationId, careerProfileId),
    getJobSourcePerformance(organizationId, careerProfileId),
    getRolePerformance(organizationId, careerProfileId),
    getCompanyPerformance(organizationId, careerProfileId),
    getRejectionReasons(organizationId, careerProfileId),
    getSkillGapAnalysis(organizationId, careerProfileId),
  ]);

  return { ok: true, period, funnel, resumePerformance, skillAssociation, channelPerformance, sourcePerformance, rolePerformance, companyPerformance, rejectionReasons, skillGaps };
}

export async function getJobMarketIntelligence() {
  // §25 — global, not org-scoped (mirrors Job's own design) — every
  // authenticated user sees the same real market data, but the caller
  // still must be signed in (no anonymous access to internal aggregates).
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "You must be signed in." };
  const snapshot = await computeJobMarketSnapshot();
  return { ok: true as const, snapshot };
}

export interface CareerInsightsPayload {
  ok: true;
  applyToday: Awaited<ReturnType<typeof whatShouldIApplyToday>>;
  needsFollowUp: Awaited<ReturnType<typeof whatNeedsFollowUp>>;
  whoRepliedList: Awaited<ReturnType<typeof whoReplied>>;
  upcomingInterviews: Awaited<ReturnType<typeof whatInterviewsAreUpcoming>>;
  skillsInDemand: Awaited<ReturnType<typeof whatSkillsAreInDemand>>;
  skillsMissing: Awaited<ReturnType<typeof whatSkillsAmIMissing>>;
  cvPerformance: Awaited<ReturnType<typeof whichCvPerformsBetter>>;
}

export async function getCareerInsights(careerProfileId: string): Promise<CareerInsightsPayload | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const organizationId = membership.organizationId;
  const [applyToday, needsFollowUp, whoRepliedList, upcomingInterviews, skillsInDemand, skillsMissing, cvPerformance] = await Promise.all([
    whatShouldIApplyToday(organizationId, careerProfileId),
    whatNeedsFollowUp(organizationId, careerProfileId),
    whoReplied(organizationId, careerProfileId),
    whatInterviewsAreUpcoming(organizationId, careerProfileId),
    whatSkillsAreInDemand(),
    whatSkillsAmIMissing(organizationId, careerProfileId),
    whichCvPerformsBetter(organizationId, careerProfileId),
  ]);

  return { ok: true, applyToday, needsFollowUp, whoRepliedList, upcomingInterviews, skillsInDemand, skillsMissing, cvPerformance };
}

export interface RecommendationActionResult {
  ok: boolean;
  error?: string;
  created?: boolean;
}

/** §18/§48 — generates and PROPOSES a career recommendation on demand; never auto-approves/auto-applies. */
export async function generateAndProposeCvRecommendation(careerProfileId: string): Promise<RecommendationActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const organizationId = membership.organizationId;
  const rec = await generateCvVersionRecommendation(organizationId, careerProfileId);
  if (!rec) return { ok: true, created: false, error: "Not enough observed data yet to propose a recommendation." };

  const proposed = await proposeCareerRecommendation(organizationId, careerProfileId, rec, []);
  if (!proposed) return { ok: true, created: false, error: "A recommendation of this type is already pending review." };

  await logAudit({
    userId,
    organizationId,
    action: "career:recommendation:proposed",
    metadata: { recommendationId: proposed.id, category: rec.category, sampleSize: rec.sampleSize },
  });

  return { ok: true, created: true };
}

export async function listCareerRecommendations(careerProfileId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false as const, error: "Career profile not found." };

  const recommendations = await prisma.learningRecommendation.findMany({
    where: { organizationId: membership.organizationId, careerProfileId },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true as const, recommendations };
}
