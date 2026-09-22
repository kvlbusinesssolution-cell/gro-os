import { prisma } from "@/lib/prisma";
import type { SendingIdentity, SendingIdentityProvider } from "@/generated/prisma/client";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — SendingIdentity
 * lifecycle: lazy registration (no manual setup required — a new identity
 * is upserted the first time a real send happens through it), rate-limit
 * checks, health scoring, and the automatic circuit breaker.
 *
 * All thresholds below are real, documented, configurable defaults — never
 * silently invented. They live on the `SendingIdentity` row itself
 * (dailyLimit/hourlyLimit) or as named constants here (bounce/complaint
 * thresholds), reported in full in the Phase 4 report rather than buried.
 */

function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(at + 1).toLowerCase();
}

export async function getOrCreateSendingIdentity(organizationId: string, email: string, provider: SendingIdentityProvider): Promise<SendingIdentity> {
  const normalized = email.trim().toLowerCase();
  const domain = extractDomain(normalized);

  return prisma.sendingIdentity.upsert({
    where: { organizationId_email: { organizationId, email: normalized } },
    create: { organizationId, email: normalized, domain, provider },
    update: {},
  });
}

// ----- Rate limiting (§12) -----
// Counters are real (incremented once per real send attempt by
// recordSendAttempt). Reset is LAZY — checked/applied right here, at
// send-time, rather than needing a separate scheduled "reset counters" job:
// an hourly counter older than 1 hour, or a daily counter from a prior
// calendar day (real Date comparison, not a cron-driven guess), is reset to
// 0 before the limit check runs. A send is blocked PRE-EMPTIVELY once the
// configured limit is reached — never relies solely on the provider itself
// returning a 429.
export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: string;
}

function isSameHour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() && a.getHours() === b.getHours();
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function checkRateLimit(identity: SendingIdentity): Promise<RateLimitCheckResult> {
  const now = new Date();

  // Lazy cooldown release — functionally already non-blocking once expired
  // (the comparison below), but also flips the stored status back to
  // ACTIVE so the UI stops showing a stale COOLDOWN badge.
  if (identity.status === "COOLDOWN" && identity.cooldownUntil && identity.cooldownUntil <= now) {
    identity = await prisma.sendingIdentity.update({ where: { id: identity.id }, data: { status: "ACTIVE", cooldownUntil: null, cooldownReason: null } });
  }

  // Lazy counter reset.
  if (!isSameHour(identity.countersResetAt, now) || !isSameDay(identity.countersResetAt, now)) {
    identity = await prisma.sendingIdentity.update({
      where: { id: identity.id },
      data: {
        sentThisHour: isSameHour(identity.countersResetAt, now) ? identity.sentThisHour : 0,
        sentToday: isSameDay(identity.countersResetAt, now) ? identity.sentToday : 0,
        countersResetAt: now,
      },
    });
  }

  if (identity.status === "PAUSED") return { allowed: false, reason: `Sending identity is PAUSED: ${identity.pausedReason ?? "no reason recorded"}.` };
  if (identity.status === "COOLDOWN" && identity.cooldownUntil && identity.cooldownUntil > now) {
    return { allowed: false, reason: `Sending identity is in COOLDOWN until ${identity.cooldownUntil.toISOString()}: ${identity.cooldownReason ?? "no reason recorded"}.` };
  }
  if (identity.sentToday >= identity.dailyLimit) return { allowed: false, reason: `Daily limit reached (${identity.sentToday}/${identity.dailyLimit}).` };
  if (identity.sentThisHour >= identity.hourlyLimit) return { allowed: false, reason: `Hourly limit reached (${identity.sentThisHour}/${identity.hourlyLimit}).` };
  return { allowed: true };
}

/** Called only after a real send attempt (success or failure) — never before, and never for a send blocked by checkRateLimit/checkSuppression (those never left the building). */
export async function recordSendAttempt(identityId: string, outcome: "sent" | "failed"): Promise<void> {
  await prisma.sendingIdentity.update({
    where: { id: identityId },
    data: {
      sentToday: outcome === "sent" ? { increment: 1 } : undefined,
      sentThisHour: outcome === "sent" ? { increment: 1 } : undefined,
      lastSendAt: outcome === "sent" ? new Date() : undefined,
      lastErrorAt: outcome === "failed" ? new Date() : undefined,
    },
  });
}

const DEFAULT_COOLDOWN_MS = 15 * 60_000; // 15 min — used when a real provider 429 has no Retry-After header

/** Called on a REAL provider 429 response. Respects Retry-After when the provider supplies it; otherwise the documented 15-minute default. */
export async function applyRateLimitCooldown(identityId: string, retryAfterSeconds: number | null): Promise<void> {
  const cooldownMs = retryAfterSeconds ? retryAfterSeconds * 1000 : DEFAULT_COOLDOWN_MS;
  await prisma.sendingIdentity.update({
    where: { id: identityId },
    data: {
      status: "COOLDOWN",
      cooldownUntil: new Date(Date.now() + cooldownMs),
      cooldownReason: `Provider returned 429 (rate limited)${retryAfterSeconds ? `, Retry-After ${retryAfterSeconds}s` : ", no Retry-After header — used default 15 min"}.`,
    },
  });
}

// ----- Health scoring & circuit breaker (§15, §18) -----
// Documented thresholds — sample-size floored (MIN_SAMPLE) so a brand-new
// identity with 1 bounce out of 2 sends is never falsely flagged CRITICAL.
export const HEALTH_THRESHOLDS = {
  MIN_SAMPLE: 20, // minimum real sends before bounce/complaint rate is trusted at all
  HARD_BOUNCE_WARNING_PCT: 2,
  HARD_BOUNCE_CRITICAL_PCT: 5,
  COMPLAINT_WARNING_PCT: 0.1,
  COMPLAINT_CRITICAL_PCT: 0.3,
  LOOKBACK_SENDS: 200, // recent-window sample size for the rate calculation
} as const;

export type HealthStatus = "GOOD" | "WARNING" | "CRITICAL" | "NOT_VERIFIED" | "UNKNOWN";

export interface SendingIdentityHealth {
  identityId: string;
  email: string;
  status: HealthStatus;
  healthScore: number; // 0-100, "GrowthOS Sending Health Score" — never claimed as real ESP reputation
  sampleSize: number;
  hardBounceRate: number | null; // null = NOT AVAILABLE (insufficient sample)
  complaintRate: number | null;
  factors: { label: string; status: HealthStatus; detail: string }[];
  action: string | null; // the recommended/taken action, or null if none needed
}

/**
 * Real, deterministic, explainable — every input is a real count from
 * EmailDraft/EmailProviderEvent, never fabricated. Triggers the circuit
 * breaker (identity → PAUSED, every ACTIVE Campaign in the org → PAUSED
 * with a real reason) only when the CRITICAL threshold is crossed with a
 * trustworthy sample size.
 */
export async function evaluateSendingIdentityHealth(identity: SendingIdentity): Promise<SendingIdentityHealth> {
  const recentSends = await prisma.emailDraft.findMany({
    where: { organizationId: identity.organizationId, status: { in: ["SENT", "BOUNCED"] } },
    orderBy: { createdAt: "desc" },
    take: HEALTH_THRESHOLDS.LOOKBACK_SENDS,
    select: { bouncedAt: true, bounceType: true, complainedAt: true },
  });

  const sampleSize = recentSends.length;
  if (sampleSize < HEALTH_THRESHOLDS.MIN_SAMPLE) {
    return {
      identityId: identity.id,
      email: identity.email,
      status: "NOT_VERIFIED",
      healthScore: 100,
      sampleSize,
      hardBounceRate: null,
      complaintRate: null,
      factors: [{ label: "Sample size", status: "NOT_VERIFIED", detail: `Only ${sampleSize} real send(s) so far — need ${HEALTH_THRESHOLDS.MIN_SAMPLE} before bounce/complaint rate is trustworthy.` }],
      action: null,
    };
  }

  const hardBounces = recentSends.filter((d) => d.bouncedAt && d.bounceType !== "soft").length;
  const complaints = recentSends.filter((d) => d.complainedAt).length;
  const hardBounceRate = (hardBounces / sampleSize) * 100;
  const complaintRate = (complaints / sampleSize) * 100;

  const factors: SendingIdentityHealth["factors"] = [];
  let worst: HealthStatus = "GOOD";

  if (hardBounceRate >= HEALTH_THRESHOLDS.HARD_BOUNCE_CRITICAL_PCT) {
    factors.push({ label: "Hard bounce rate", status: "CRITICAL", detail: `${hardBounceRate.toFixed(1)}% (threshold ${HEALTH_THRESHOLDS.HARD_BOUNCE_CRITICAL_PCT}%).` });
    worst = "CRITICAL";
  } else if (hardBounceRate >= HEALTH_THRESHOLDS.HARD_BOUNCE_WARNING_PCT) {
    factors.push({ label: "Hard bounce rate", status: "WARNING", detail: `${hardBounceRate.toFixed(1)}% (threshold ${HEALTH_THRESHOLDS.HARD_BOUNCE_WARNING_PCT}%).` });
    worst = "WARNING";
  } else {
    factors.push({ label: "Hard bounce rate", status: "GOOD", detail: `${hardBounceRate.toFixed(1)}%.` });
  }

  if (complaintRate >= HEALTH_THRESHOLDS.COMPLAINT_CRITICAL_PCT) {
    factors.push({ label: "Complaint rate", status: "CRITICAL", detail: `${complaintRate.toFixed(2)}% (threshold ${HEALTH_THRESHOLDS.COMPLAINT_CRITICAL_PCT}%).` });
    worst = "CRITICAL";
  } else if (complaintRate >= HEALTH_THRESHOLDS.COMPLAINT_WARNING_PCT) {
    factors.push({ label: "Complaint rate", status: "WARNING", detail: `${complaintRate.toFixed(2)}% (threshold ${HEALTH_THRESHOLDS.COMPLAINT_WARNING_PCT}%).` });
    if (worst !== "CRITICAL") worst = "WARNING";
  } else {
    factors.push({ label: "Complaint rate", status: "GOOD", detail: `${complaintRate.toFixed(2)}%.` });
  }

  factors.push({
    label: "Rate limit",
    status: identity.status === "COOLDOWN" ? "WARNING" : "GOOD",
    detail: identity.status === "COOLDOWN" ? `In cooldown until ${identity.cooldownUntil?.toISOString()}.` : "Normal.",
  });

  const healthScore = clamp(100 - hardBounceRate * 8 - complaintRate * 30 - (identity.status === "COOLDOWN" ? 10 : 0));

  let action: string | null = null;
  if (worst === "CRITICAL" && identity.status !== "PAUSED") {
    action = await pauseSendingIdentityAndCampaigns(identity, `Hard bounce rate ${hardBounceRate.toFixed(1)}% or complaint rate ${complaintRate.toFixed(2)}% exceeded the critical threshold.`);
  }

  return {
    identityId: identity.id,
    email: identity.email,
    status: identity.status === "PAUSED" ? "CRITICAL" : worst,
    healthScore,
    sampleSize,
    hardBounceRate,
    complaintRate,
    factors,
    action,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** The automatic circuit breaker (§15). Reuses the real `Campaign.status`/`PAUSED` value and the same underlying update `setCampaignStatus` already uses — never a second pause mechanism. Since a SendingIdentity is currently the one shared per-org sender, pausing it pauses every ACTIVE campaign in that org (documented, not silent). */
async function pauseSendingIdentityAndCampaigns(identity: SendingIdentity, reason: string): Promise<string> {
  await prisma.sendingIdentity.update({
    where: { id: identity.id },
    data: { status: "PAUSED", pausedAt: new Date(), pausedReason: reason },
  });

  const activeCampaigns = await prisma.campaign.findMany({ where: { organizationId: identity.organizationId, status: "ACTIVE" } });
  for (const campaign of activeCampaigns) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED", pausedAt: new Date(), pausedReason: `Automatically paused — sending identity ${identity.email} was paused: ${reason}` },
    });
  }
  return `Sending identity paused; ${activeCampaigns.length} active campaign(s) in this organization automatically paused.`;
}
