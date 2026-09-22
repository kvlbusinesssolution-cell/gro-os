import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { checkRateLimit, applyRateLimitCooldown, evaluateSendingIdentityHealth, getOrCreateSendingIdentity, HEALTH_THRESHOLDS, warmupFraction } from "./sending-identity";

/**
 * Phase 30 (Enterprise Email Deliverability Engine) — real local-Postgres
 * integration tests for Phase 4's already-real but previously-untested
 * sending-identity logic: rate limiting, cooldown, and the health-score
 * circuit breaker that auto-pauses an identity + every ACTIVE campaign in
 * its org. Never mocked Prisma — every assertion is against real rows this
 * test creates itself.
 */
describe("sending-identity", () => {
  let orgId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Sending Identity Test Org", slug: `sid-test-org-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.sendingIdentity.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  describe("checkRateLimit", () => {
    it("allows a fresh identity under its daily/hourly limits", async () => {
      const identity = await getOrCreateSendingIdentity(orgId, `fresh-${Date.now()}@example.com`, "RESEND");
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(true);
    });

    it("blocks once the real daily limit is reached", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `daily-full-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND", dailyLimit: 5, sentToday: 5 },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Daily limit reached");
    });

    it("blocks once the real hourly limit is reached", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `hourly-full-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND", hourlyLimit: 3, sentThisHour: 3 },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Hourly limit reached");
    });

    it("lazily resets the hourly counter once countersResetAt is from a real prior hour", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: {
          organizationId: orgId,
          email: `stale-hour-${Date.now()}@example.com`,
          domain: "example.com",
          provider: "RESEND",
          hourlyLimit: 3,
          sentThisHour: 3,
          countersResetAt: new Date(Date.now() - 2 * 60 * 60_000), // 2 real hours ago
        },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(true);
      const refreshed = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      expect(refreshed.sentThisHour).toBe(0);
    });

    it("blocks a real PAUSED identity regardless of counters", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `paused-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND", status: "PAUSED", pausedReason: "test" },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("PAUSED");
    });

    it("lazily releases a real expired COOLDOWN back to ACTIVE and allows the send", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: {
          organizationId: orgId,
          email: `cooldown-expired-${Date.now()}@example.com`,
          domain: "example.com",
          provider: "RESEND",
          status: "COOLDOWN",
          cooldownUntil: new Date(Date.now() - 60_000), // 1 real minute in the past — already expired
        },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(true);
      const refreshed = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      expect(refreshed.status).toBe("ACTIVE");
      expect(refreshed.cooldownUntil).toBeNull();
    });
  });

  describe("warmup", () => {
    it("warmupFraction returns 0.2 for a real brand-new identity (day 0)", () => {
      expect(warmupFraction(new Date())).toBe(0.2);
    });

    it("warmupFraction ramps to 0.5 after real day 7, 0.8 after day 14, and 1 (no cap) after day 21", () => {
      const now = new Date();
      expect(warmupFraction(new Date(now.getTime() - 8 * 86_400_000), now)).toBe(0.5);
      expect(warmupFraction(new Date(now.getTime() - 15 * 86_400_000), now)).toBe(0.8);
      expect(warmupFraction(new Date(now.getTime() - 22 * 86_400_000), now)).toBe(1);
    });

    it("checkRateLimit caps a real brand-new identity below its full configured dailyLimit", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `warmup-new-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND", dailyLimit: 100, sentToday: 25 },
      });
      // 25/100 is under the configured limit, but the real warmup fraction (0.2) caps the effective limit at 20 — should be blocked.
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("warming up");
    });

    it("checkRateLimit allows a real fully-warmed-up (old) identity to use its full configured dailyLimit", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: {
          organizationId: orgId,
          email: `warmup-old-${Date.now()}@example.com`,
          domain: "example.com",
          provider: "RESEND",
          dailyLimit: 100,
          sentToday: 90,
          createdAt: new Date(Date.now() - 30 * 86_400_000), // real 30 days old — fully warmed up
        },
      });
      const result = await checkRateLimit(identity);
      expect(result.allowed).toBe(true);
    });
  });

  describe("applyRateLimitCooldown", () => {
    it("honors a real Retry-After value from the provider", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `retry-after-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND" },
      });
      await applyRateLimitCooldown(identity.id, 30);
      const refreshed = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      expect(refreshed.status).toBe("COOLDOWN");
      const seconds = (refreshed.cooldownUntil!.getTime() - Date.now()) / 1000;
      expect(seconds).toBeGreaterThan(25);
      expect(seconds).toBeLessThan(31);
    });

    it("falls back to the documented 15-minute default when no Retry-After header is present", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `no-retry-after-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND" },
      });
      await applyRateLimitCooldown(identity.id, null);
      const refreshed = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      const minutes = (refreshed.cooldownUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThan(16);
    });
  });

  describe("evaluateSendingIdentityHealth — circuit breaker", () => {
    it("returns NOT_VERIFIED and takes no action below the real MIN_SAMPLE, even with a high raw bounce percentage", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `small-sample-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND" },
      });
      const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Small", lastName: "Sample", email: `small-sample-contact-${Date.now()}@example.com` } });
      // 5 real sends, 3 real hard bounces — 60% raw bounce rate, but well under MIN_SAMPLE=20.
      for (let i = 0; i < 5; i++) {
        await prisma.emailDraft.create({
          data: {
            organizationId: orgId,
            contactId: contact.id,
            channel: "EMAIL",
            purpose: "INTRODUCTION",
            tone: "PROFESSIONAL",
            body: "Body.",
            status: i < 3 ? "BOUNCED" : "SENT",
            sentAt: new Date(),
            bouncedAt: i < 3 ? new Date() : null,
            bounceType: i < 3 ? "hard" : null,
          },
        });
      }

      const health = await evaluateSendingIdentityHealth(identity);
      expect(health.status).toBe("NOT_VERIFIED");
      expect(health.action).toBeNull();
      expect(health.hardBounceRate).toBeNull();

      const refreshed = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      expect(refreshed.status).not.toBe("PAUSED");
    });

    it("auto-pauses the identity AND every real ACTIVE campaign in the org once a trustworthy sample crosses the CRITICAL hard-bounce threshold", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `critical-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND" },
      });
      const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Critical", lastName: "Sample", email: `critical-contact-${Date.now()}@example.com` } });
      const creator = await prisma.user.create({ data: { name: "Circuit Breaker Test User", email: `cb-test-user-${Date.now()}@example.com` } });
      const campaign = await prisma.campaign.create({ data: { organizationId: orgId, name: "Circuit Breaker Test Campaign", type: "STANDARD", status: "ACTIVE", createdByUserId: creator.id } });

      // Real sample of MIN_SAMPLE (20) sends, with a real hard-bounce rate
      // above HARD_BOUNCE_CRITICAL_PCT (5%) — 3/20 = 15%.
      const total = HEALTH_THRESHOLDS.MIN_SAMPLE;
      const hardBounces = 3;
      for (let i = 0; i < total; i++) {
        await prisma.emailDraft.create({
          data: {
            organizationId: orgId,
            contactId: contact.id,
            channel: "EMAIL",
            purpose: "INTRODUCTION",
            tone: "PROFESSIONAL",
            body: "Body.",
            status: i < hardBounces ? "BOUNCED" : "SENT",
            sentAt: new Date(),
            bouncedAt: i < hardBounces ? new Date() : null,
            bounceType: i < hardBounces ? "hard" : null,
          },
        });
      }

      const health = await evaluateSendingIdentityHealth(identity);
      expect(health.status).toBe("CRITICAL");
      expect(health.action).not.toBeNull();
      expect(health.action).toContain("paused");

      const refreshedIdentity = await prisma.sendingIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      expect(refreshedIdentity.status).toBe("PAUSED");
      expect(refreshedIdentity.pausedReason).toBeTruthy();

      const refreshedCampaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      expect(refreshedCampaign.status).toBe("PAUSED");
      expect(refreshedCampaign.pausedReason).toContain(identity.email);

      await prisma.campaign.deleteMany({ where: { id: campaign.id } });
      await prisma.user.deleteMany({ where: { id: creator.id } });
    });

    it("does not re-trigger the pause action for an identity that is already PAUSED, even with a real CRITICAL-crossing sample", async () => {
      const identity = await prisma.sendingIdentity.create({
        data: { organizationId: orgId, email: `already-paused-${Date.now()}@example.com`, domain: "example.com", provider: "RESEND", status: "PAUSED", pausedReason: "prior real pause" },
      });
      const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Already", lastName: "Paused", email: `already-paused-contact-${Date.now()}@example.com` } });
      const total = HEALTH_THRESHOLDS.MIN_SAMPLE;
      for (let i = 0; i < total; i++) {
        await prisma.emailDraft.create({
          data: {
            organizationId: orgId,
            contactId: contact.id,
            channel: "EMAIL",
            purpose: "INTRODUCTION",
            tone: "PROFESSIONAL",
            body: "Body.",
            status: i < 3 ? "BOUNCED" : "SENT", // 15% hard-bounce rate — real CRITICAL-crossing sample
            sentAt: new Date(),
            bouncedAt: i < 3 ? new Date() : null,
            bounceType: i < 3 ? "hard" : null,
          },
        });
      }
      const health = await evaluateSendingIdentityHealth(identity);
      // The underlying rate IS critical (status reported as CRITICAL), but
      // the pause action is guarded by `identity.status !== "PAUSED"` — an
      // already-paused identity is never re-processed.
      expect(health.status).toBe("CRITICAL");
      expect(health.action).toBeNull();
    });
  });
});
