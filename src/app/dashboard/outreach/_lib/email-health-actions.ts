"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { evaluateSendingIdentityHealth } from "@/lib/outreach/sending-identity";
import { checkDomainHealth } from "@/lib/outreach/domain-health";

/**
 * Phase 4 (Email Deliverability & Sender Health Engine) — API/admin-control
 * surface. Same session/tenant-isolation pattern as every other _lib
 * actions file in this codebase (reused, not reinvented).
 */

async function requireMembership(): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false, error: "No active organization membership." };
  return { ok: true, userId, organizationId: membership.organizationId };
}

export interface EmailHealthActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** GET email health overview — every SendingIdentity in the caller's org, real health + real domain DNS check. */
export async function getEmailHealthOverviewAction() {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false as const, error: membership.error };

  const identities = await prisma.sendingIdentity.findMany({ where: { organizationId: membership.organizationId }, orderBy: { createdAt: "asc" } });
  const domains = [...new Set(identities.map((i) => i.domain))];

  const [healths, domainChecks] = await Promise.all([
    Promise.all(identities.map((identity) => evaluateSendingIdentityHealth(identity))),
    Promise.all(domains.map((domain) => checkDomainHealth(domain))),
  ]);

  return {
    ok: true as const,
    data: {
      identities: identities.map((identity, i) => ({
        id: identity.id,
        email: identity.email,
        domain: identity.domain,
        provider: identity.provider,
        status: identity.status,
        dailyLimit: identity.dailyLimit,
        hourlyLimit: identity.hourlyLimit,
        sentToday: identity.sentToday,
        sentThisHour: identity.sentThisHour,
        cooldownUntil: identity.cooldownUntil?.toISOString() ?? null,
        pausedReason: identity.pausedReason,
        lastSendAt: identity.lastSendAt?.toISOString() ?? null,
        health: healths[i],
      })),
      domains: domainChecks,
    },
  };
}

/** GET suppression list — real SuppressionEntry rows for this org (email addresses masked in the returned label, per rule 29 — never expose raw PII beyond what's already visible elsewhere in the CRM). */
export async function getSuppressionListAction() {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false as const, error: membership.error };

  const entries = await prisma.suppressionEntry.findMany({ where: { organizationId: membership.organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
  return { ok: true as const, data: entries };
}

/** GET provider event history — real EmailProviderEvent rows. */
export async function getProviderEventHistoryAction() {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false as const, error: membership.error };

  const events = await prisma.emailProviderEvent.findMany({ where: { organizationId: membership.organizationId }, orderBy: { receivedAt: "desc" }, take: 100 });
  return { ok: true as const, data: events };
}

/** Manual "Pause Sending Identity" (admin control, §25) — audit-logged. */
export async function pauseSendingIdentityAction(identityId: string, reason: string): Promise<EmailHealthActionResult<null>> {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false, error: membership.error };

  const identity = await prisma.sendingIdentity.findFirst({ where: { id: identityId, organizationId: membership.organizationId } });
  if (!identity) return { ok: false, error: "Sending identity not found." };

  await prisma.sendingIdentity.update({ where: { id: identityId }, data: { status: "PAUSED", pausedAt: new Date(), pausedReason: reason } });
  await logAudit({ userId: membership.userId, organizationId: membership.organizationId, action: "email_health.identity.pause_manual", metadata: { identityId, reason } });
  revalidatePath("/dashboard/outreach/email-health");
  return { ok: true, data: null };
}

/** Manual "Resume Sending Identity" — audit-logged. */
export async function resumeSendingIdentityAction(identityId: string): Promise<EmailHealthActionResult<null>> {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false, error: membership.error };

  const identity = await prisma.sendingIdentity.findFirst({ where: { id: identityId, organizationId: membership.organizationId } });
  if (!identity) return { ok: false, error: "Sending identity not found." };

  await prisma.sendingIdentity.update({ where: { id: identityId }, data: { status: "ACTIVE", pausedAt: null, pausedReason: null, cooldownUntil: null, cooldownReason: null } });
  await logAudit({ userId: membership.userId, organizationId: membership.organizationId, action: "email_health.identity.resume_manual", metadata: { identityId } });
  revalidatePath("/dashboard/outreach/email-health");
  return { ok: true, data: null };
}

/** Configure daily/hourly limits (admin control, §25) — audit-logged, previous/new values recorded. */
export async function configureSendingIdentityLimitsAction(identityId: string, dailyLimit: number, hourlyLimit: number): Promise<EmailHealthActionResult<null>> {
  const membership = await requireMembership();
  if (!membership.ok) return { ok: false, error: membership.error };
  if (dailyLimit < 1 || hourlyLimit < 1 || dailyLimit > 100_000 || hourlyLimit > 100_000) {
    return { ok: false, error: "Limits must be positive and reasonable (1-100,000)." };
  }

  const identity = await prisma.sendingIdentity.findFirst({ where: { id: identityId, organizationId: membership.organizationId } });
  if (!identity) return { ok: false, error: "Sending identity not found." };

  await prisma.sendingIdentity.update({ where: { id: identityId }, data: { dailyLimit, hourlyLimit } });
  await logAudit({
    userId: membership.userId,
    organizationId: membership.organizationId,
    action: "email_health.identity.limits_changed",
    metadata: { identityId, previousDailyLimit: identity.dailyLimit, newDailyLimit: dailyLimit, previousHourlyLimit: identity.hourlyLimit, newHourlyLimit: hourlyLimit },
  });
  revalidatePath("/dashboard/outreach/email-health");
  return { ok: true, data: null };
}
