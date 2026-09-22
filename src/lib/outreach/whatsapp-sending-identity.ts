import { prisma } from "@/lib/prisma";
import type { WhatsAppSendingIdentity } from "@/generated/prisma/client";

/**
 * Phase 8 (WhatsApp Business Outreach) — rate-limit/health state for the
 * org's WhatsApp Business sender number. Mirrors sending-identity.ts's
 * exact lazy-reset/cooldown algorithm (§31) — see WhatsAppSendingIdentity's
 * schema doc comment for why this is its own model rather than reusing
 * SendingIdentity's email+domain-shaped table.
 */

export async function getOrCreateWhatsAppSendingIdentity(organizationId: string, phoneNumber: string): Promise<WhatsAppSendingIdentity> {
  return prisma.whatsAppSendingIdentity.upsert({
    where: { organizationId_phoneNumber: { organizationId, phoneNumber } },
    create: { organizationId, phoneNumber },
    update: {},
  });
}

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

export async function checkWhatsAppRateLimit(identity: WhatsAppSendingIdentity): Promise<RateLimitCheckResult> {
  const now = new Date();

  if (identity.status === "COOLDOWN" && identity.cooldownUntil && identity.cooldownUntil <= now) {
    identity = await prisma.whatsAppSendingIdentity.update({ where: { id: identity.id }, data: { status: "ACTIVE", cooldownUntil: null, cooldownReason: null } });
  }

  if (!isSameHour(identity.countersResetAt, now) || !isSameDay(identity.countersResetAt, now)) {
    identity = await prisma.whatsAppSendingIdentity.update({
      where: { id: identity.id },
      data: {
        sentThisHour: isSameHour(identity.countersResetAt, now) ? identity.sentThisHour : 0,
        sentToday: isSameDay(identity.countersResetAt, now) ? identity.sentToday : 0,
        countersResetAt: now,
      },
    });
  }

  if (identity.status === "PAUSED") return { allowed: false, reason: `WhatsApp sender is PAUSED: ${identity.pausedReason ?? "no reason recorded"}.` };
  if (identity.status === "COOLDOWN" && identity.cooldownUntil && identity.cooldownUntil > now) {
    return { allowed: false, reason: `WhatsApp sender is in COOLDOWN until ${identity.cooldownUntil.toISOString()}: ${identity.cooldownReason ?? "no reason recorded"}.` };
  }
  if (identity.sentToday >= identity.dailyLimit) return { allowed: false, reason: `Daily WhatsApp limit reached (${identity.sentToday}/${identity.dailyLimit}).` };
  if (identity.sentThisHour >= identity.hourlyLimit) return { allowed: false, reason: `Hourly WhatsApp limit reached (${identity.sentThisHour}/${identity.hourlyLimit}).` };
  return { allowed: true };
}

/** Called only after a real send attempt — never before, and never for a send blocked pre-emptively. */
export async function recordWhatsAppSendAttempt(identityId: string, outcome: "sent" | "failed"): Promise<void> {
  await prisma.whatsAppSendingIdentity.update({
    where: { id: identityId },
    data: {
      sentToday: outcome === "sent" ? { increment: 1 } : undefined,
      sentThisHour: outcome === "sent" ? { increment: 1 } : undefined,
      lastSendAt: outcome === "sent" ? new Date() : undefined,
      lastErrorAt: outcome === "failed" ? new Date() : undefined,
    },
  });
}

const DEFAULT_COOLDOWN_MS = 15 * 60_000;

/** Called on a REAL Twilio 429/rate-limit response (§31/§32) — never a fabricated or preemptive cooldown. */
export async function applyWhatsAppRateLimitCooldown(identityId: string, retryAfterSeconds: number | null, reason?: string): Promise<void> {
  const cooldownMs = retryAfterSeconds ? retryAfterSeconds * 1000 : DEFAULT_COOLDOWN_MS;
  await prisma.whatsAppSendingIdentity.update({
    where: { id: identityId },
    data: {
      status: "COOLDOWN",
      cooldownUntil: new Date(Date.now() + cooldownMs),
      cooldownReason: reason ?? `Provider returned a rate-limit response${retryAfterSeconds ? `, Retry-After ${retryAfterSeconds}s` : ", no Retry-After header — used default 15 min"}.`,
    },
  });
}
