import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { computeIntentScore } from "./intent-scoring";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/CompanyIntelligence/CompanyEvidence/IntentScore created during
// the test).
describe("computeIntentScore", () => {
  let organizationId: string;
  let loggedByUserId: string;

  let signalCompanyId: string;
  let zeroSignalCompanyId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Intent Score Test Org", slug: `intent-score-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { name: "Intent Score Test User", email: `intent-score-test-user-${Date.now()}@example.com` },
    });
    loggedByUserId = user.id;

    // Company with real, populated signal lists + a real poor-performance
    // CompanyEvidence fact — every one of these traces back to a fixture
    // value asserted below, nothing fabricated by the function under test.
    const signalCompany = await prisma.company.create({
      data: {
        organizationId,
        name: "Signal Rich Co",
        industry: "Retail",
        website: "https://signal-rich.example.com",
      },
    });
    signalCompanyId = signalCompany.id;

    await prisma.companyIntelligence.create({
      data: {
        companyId: signalCompanyId,
        businessSummary: "A growing regional retailer.",
        growthSignals: ["Opened a second warehouse this quarter", "Revenue grew 30% year-over-year"],
        hiringSignals: ["Hiring a Head of E-commerce", "3 open engineering roles posted"],
        expansionIndicators: ["Announced expansion into two new states"],
        businessOpportunities: [],
        estimatedSoftwareNeeds: [],
        potentialPainPoints: [],
        confidenceScore: 0.75,
      },
    });

    await prisma.companyEvidence.create({
      data: {
        companyId: signalCompanyId,
        kind: "RAW_FACT",
        fact: "Performance score: 32/100",
        source: "WEBSITE_SCAN",
        confidence: 1.0,
      },
    });
    // A healthy score should NOT count as a problem signal.
    await prisma.companyEvidence.create({
      data: {
        companyId: signalCompanyId,
        kind: "RAW_FACT",
        fact: "SEO score: 88/100",
        source: "WEBSITE_SCAN",
        confidence: 1.0,
      },
    });

    // Company with no CompanyIntelligence and no CompanyEvidence at all —
    // the honest zero-signal case.
    const zeroSignalCompany = await prisma.company.create({
      data: {
        organizationId,
        name: "No Signal Co",
        industry: "Retail",
        website: "https://no-signal.example.com",
      },
    });
    zeroSignalCompanyId = zeroSignalCompany.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: loggedByUserId } });

    const leaked = await prisma.company.count({ where: { organizationId } });
    expect(leaked).toBe(0);
  });

  it("computes a score/band/signals breakdown where every signal traces to a real fixture value", async () => {
    const result = await computeIntentScore(signalCompanyId);
    expect(result).not.toBeNull();
    if (!result) return;

    // 2 growth signals * 8 = 16, 2 hiring signals * 10 = 20, 1 expansion * 12 = 12,
    // 1 real problem fact (Performance 32/100 < 50) * 6 = 6. Subtotal = 54.
    // Data is fresh (just created) so +10 recency bonus => 64.
    expect(result.score).toBe(64);
    expect(result.band).toBe("MEDIUM");

    const detailTexts = result.signals.map((s) => s.detail);
    expect(detailTexts).toContain("Opened a second warehouse this quarter");
    expect(detailTexts).toContain("Revenue grew 30% year-over-year");
    expect(detailTexts).toContain("Hiring a Head of E-commerce");
    expect(detailTexts).toContain("3 open engineering roles posted");
    expect(detailTexts).toContain("Announced expansion into two new states");
    expect(detailTexts).toContain("Performance score: 32/100");
    // The healthy SEO fact must never be counted as a problem signal.
    expect(detailTexts).not.toContain("SEO score: 88/100");

    const totalPoints = result.signals.reduce((sum, s) => sum + s.points, 0);
    expect(totalPoints).toBe(64);

    expect(result.reasoning).toContain("Opened a second warehouse this quarter");
    expect(result.reasoning).toContain("64");
    expect(result.reasoning).toContain("MEDIUM");
  });

  it("persists an upserted IntentScore row and is idempotent on re-run (no duplicate rows)", async () => {
    await computeIntentScore(signalCompanyId);
    const firstCount = await prisma.intentScore.count({ where: { companyId: signalCompanyId } });
    expect(firstCount).toBe(1);

    const rerun = await computeIntentScore(signalCompanyId);
    const secondCount = await prisma.intentScore.count({ where: { companyId: signalCompanyId } });
    expect(secondCount).toBe(1); // unique constraint on companyId enforces upsert-not-append

    const row = await prisma.intentScore.findUnique({ where: { companyId: signalCompanyId } });
    expect(row).not.toBeNull();
    expect(row?.score).toBe(rerun?.score);
    expect(row?.band).toBe(rerun?.band);
  });

  it("returns score 0, band NONE, and an honest empty-case reasoning when there are no signals at all", async () => {
    const result = await computeIntentScore(zeroSignalCompanyId);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.score).toBe(0);
    expect(result.band).toBe("NONE");
    expect(result.signals).toEqual([]);
    expect(result.reasoning).toContain("No buying-intent signals found");
    expect(result.reasoning).not.toMatch(/lorem|placeholder/i);

    const row = await prisma.intentScore.findUnique({ where: { companyId: zeroSignalCompanyId } });
    expect(row?.score).toBe(0);
    expect(row?.band).toBe("NONE");
  });

  it("returns null for a nonexistent companyId", async () => {
    const result = await computeIntentScore("nonexistent-company-id-does-not-exist");
    expect(result).toBeNull();
  });

  it("applies real decay — an old reply contributes fewer points than a fresh one with identical intent", async () => {
    const freshCo = await prisma.company.create({ data: { organizationId, name: "Fresh Reply Co" } });
    const staleCo = await prisma.company.create({ data: { organizationId, name: "Aged Reply Co" } });

    const freshContact = await prisma.contact.create({
      data: { organizationId, companyId: freshCo.id, firstName: "Fresh", email: `fresh-${Date.now()}@example.com` },
    });
    const staleContact = await prisma.contact.create({
      data: { organizationId, companyId: staleCo.id, firstName: "Stale", email: `stale-${Date.now()}@example.com` },
    });

    // REPLY_DECAY = { fullWeightDays: 7, floorDays: 30, floorMultiplier: 0.2 }.
    // INTERESTED = 8 base points. At age 20 days (inside the taper window):
    // span=23, progress=(20-7)/23≈0.565, multiplier≈1-0.565*0.8≈0.548 → round(8*0.548)=4.
    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: freshContact.id, intent: "INTERESTED", channel: "EMAIL", content: "Thanks, interested — tell me more.", receivedAt: new Date() },
    });
    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: staleContact.id, intent: "INTERESTED", channel: "EMAIL", content: "Thanks, interested — tell me more.", receivedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });

    const freshResult = await computeIntentScore(freshCo.id);
    const staleResult = await computeIntentScore(staleCo.id);

    const freshSignal = freshResult?.signals.find((s) => s.source === "replyEngagement");
    const staleSignal = staleResult?.signals.find((s) => s.source === "replyEngagement");

    expect(freshSignal?.points).toBe(8); // full weight, within fullWeightDays
    expect(staleSignal?.points).toBe(4); // real, computed decay — not fabricated, not zero
    expect(staleSignal!.points).toBeLessThan(freshSignal!.points);
  });

  it("never fully zeroes an old signal — applies the real floor multiplier past floorDays, not zero", async () => {
    const floorCo = await prisma.company.create({ data: { organizationId, name: "Past Floor Co" } });
    const floorContact = await prisma.contact.create({
      data: { organizationId, companyId: floorCo.id, firstName: "OldSignal", email: `floor-${Date.now()}@example.com` },
    });

    // 35 days > floorDays (30) → floorMultiplier 0.2 flat. round(8 * 0.2) = 2.
    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: floorContact.id, intent: "INTERESTED", channel: "EMAIL", content: "Thanks, interested — tell me more.", receivedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) },
    });

    const result = await computeIntentScore(floorCo.id);
    const signal = result?.signals.find((s) => s.source === "replyEngagement");

    expect(signal).toBeDefined();
    expect(signal?.points).toBe(2); // real floor value — never fully deleted/zeroed
    expect(signal!.points).toBeGreaterThan(0);
  });

  it("does not inflate a score into HIGH band from weak/borderline evidence alone (false-positive guard)", async () => {
    const weakCo = await prisma.company.create({ data: { organizationId, name: "Weak Evidence Co" } });
    const weakContact = await prisma.contact.create({
      data: { organizationId, companyId: weakCo.id, firstName: "Weak", email: `weak-${Date.now()}@example.com` },
    });

    // A single low-weight reply (FOLLOW_UP_LATER = 4 points) is the only
    // real evidence — nowhere near HIGH (70+) or even MEDIUM (40+).
    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: weakContact.id, intent: "FOLLOW_UP_LATER", channel: "EMAIL", content: "Circle back next month please.", receivedAt: new Date() },
    });

    const result = await computeIntentScore(weakCo.id);
    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThan(40);
    expect(result!.band).not.toBe("HIGH");
    expect(result!.band).not.toBe("MEDIUM");
  });

  it("handles a real contradictory-signal sequence (positive reply, then a later NOT_INTERESTED reply) without fabricating a negative score or double-counting", async () => {
    const conflictCo = await prisma.company.create({ data: { organizationId, name: "Conflicting Signals Co" } });
    const conflictContact = await prisma.contact.create({
      data: { organizationId, companyId: conflictCo.id, firstName: "Conflict", email: `conflict-${Date.now()}@example.com` },
    });

    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: conflictContact.id, intent: "INTERESTED", channel: "EMAIL", content: "Thanks, interested — tell me more.", receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    });
    // A later reply retracting interest — REPLY_INTENT_POINTS has no entry
    // for NOT_INTERESTED, so it contributes exactly 0, never a fabricated
    // negative adjustment (this codebase's scoring never subtracts).
    await prisma.reply.create({
      data: { organizationId, loggedByUserId, contactId: conflictContact.id, intent: "NOT_INTERESTED", channel: "EMAIL", content: "Actually not interested, please remove me.", receivedAt: new Date() },
    });

    const result = await computeIntentScore(conflictCo.id);
    expect(result).not.toBeNull();
    const replySignals = result!.signals.filter((s) => s.source === "replyEngagement");
    // Only the real positive-evidence reply is counted — the NOT_INTERESTED
    // reply contributes no signal row at all (not a fabricated 0-point row).
    expect(replySignals).toHaveLength(1);
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.score).toBeLessThan(40); // one aged-2-day INTERESTED reply alone stays well under HIGH/MEDIUM
  });
});
