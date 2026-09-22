import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeReplyLikelihood, computeMeetingLikelihood, computeOpportunityLikelihood } from "./pre-deal-likelihood";

/**
 * Real local-Postgres integration test (same convention as accuracy.test.ts)
 * — synthetic EmailDraft/Reply/OutreachMeeting/Company/Contact/
 * LeadOpportunity rows under one throwaway Organization.
 */
describe("pre-deal likelihood predictions", () => {
  let orgId: string;
  let contactId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Pre-Deal Likelihood Test Org", slug: `pre-deal-likelihood-test-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Pre-Deal Likelihood Test User", email: `pre-deal-likelihood-user-${suffix}@example.com` } });
    userId = user.id;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Test", email: `contact-${suffix}@example.com` } });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.reply.deleteMany({ where: { organizationId: orgId } });
    await prisma.outreachMeeting.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.leadOpportunity.deleteMany({ where: { company: { organizationId: orgId } } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns INSUFFICIENT_DATA (never a fabricated rate) with zero sample", async () => {
    const result = await computeReplyLikelihood(orgId, "WHATSAPP");
    expect(result.sampleSize).toBe(0);
    expect(result.likelihood).toBeNull();
    expect(result.insufficientData).toBe(true);
    expect(result.sampleClassification).toBe("INSUFFICIENT_DATA");
  });

  it("computes a real reply likelihood from real sent drafts + real linked replies", async () => {
    // 12 real SENT EMAIL drafts, 3 with a real linked Reply.
    const drafts = await Promise.all(
      Array.from({ length: 12 }, () =>
        prisma.emailDraft.create({
          data: { organizationId: orgId, contactId, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "test", status: "SENT" },
        }),
      ),
    );
    await Promise.all(
      drafts.slice(0, 3).map((d) => prisma.reply.create({ data: { organizationId: orgId, contactId, emailDraftId: d.id, channel: "EMAIL", content: "real reply", loggedByUserId: userId } })),
    );

    const result = await computeReplyLikelihood(orgId, "EMAIL");
    expect(result.sampleSize).toBe(12);
    expect(result.numerator).toBe(3);
    expect(result.likelihood).toBeCloseTo(0.25, 5);
    expect(result.insufficientData).toBe(false);
    // 12 samples clears MIN_SAMPLE (10) but is still LOW_SAMPLE tier (10-20) — honestly LOW confidence, not fabricated certainty.
    expect(result.sampleClassification).toBe("LOW_SAMPLE");
    expect(result.confidence).toBe("LOW");
  });

  it("computes a real meeting likelihood, independently of reply likelihood, from real linked OutreachMeeting rows", async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () => prisma.emailDraft.create({ data: { organizationId: orgId, contactId, channel: "LINKEDIN", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "test", status: "SENT" } })),
    );
    await prisma.outreachMeeting.create({ data: { organizationId: orgId, contactId, emailDraftId: drafts[0]!.id, title: "Intro call", discussionTopics: [] } });

    const result = await computeMeetingLikelihood(orgId, "LINKEDIN");
    expect(result.sampleSize).toBe(10);
    expect(result.numerator).toBe(1);
    expect(result.likelihood).toBeCloseTo(0.1, 5);
  });

  it("computes a real opportunity likelihood from companies with real reply engagement leading to a real LeadOpportunity", async () => {
    const suffix = Date.now();
    const companies = await Promise.all(
      Array.from({ length: 11 }, (_, i) => prisma.company.create({ data: { organizationId: orgId, name: `Opp Likelihood Co ${suffix}-${i}`, industry: "Software" } })),
    );
    const contacts = await Promise.all(companies.map((c) => prisma.contact.create({ data: { organizationId: orgId, companyId: c.id, firstName: "C", email: `c-${c.id}@example.com` } })));
    // Every company gets a real Reply (the cohort qualifier).
    await Promise.all(contacts.map((c) => prisma.reply.create({ data: { organizationId: orgId, contactId: c.id, channel: "EMAIL", content: "real reply", loggedByUserId: userId } })));
    // Only 2 of the 11 companies go on to have a real LeadOpportunity.
    await Promise.all(
      companies.slice(0, 2).map((c) => prisma.leadOpportunity.create({ data: { companyId: c.id, category: "test", title: "test", description: "test", estimatedImpact: "test", evidence: "test", confidenceScore: 50 } })),
    );

    const result = await computeOpportunityLikelihood(orgId, "Software");
    expect(result.sampleSize).toBe(11);
    expect(result.numerator).toBe(2);
    expect(result.likelihood).toBeCloseTo(2 / 11, 5);
  });
});
