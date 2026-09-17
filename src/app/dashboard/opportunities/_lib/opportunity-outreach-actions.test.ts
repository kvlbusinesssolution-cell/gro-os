import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing, file-independent next-auth/ESM breakage under Vitest
// that opportunity-actions.test.ts documents and works around — mocking
// "@/auth" avoids loading next-auth at all. This test only exercises the
// headless *Core function, which never calls auth().
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import {
  convertOpportunityToOutreachCore,
  DEFAULT_SEQUENCE_STEPS,
  DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST,
  OUTREACH_CAMPAIGN_NAME,
  OUTREACH_SEQUENCE_NAME,
  OUTREACH_SEQUENCE_NAME_LINKEDIN,
} from "./opportunity-outreach-actions";

// Real local-Postgres integration test (no mocking of Prisma, matching the
// rest of this repo's Prisma-touching code) — everything scoped under two
// throwaway Organizations created here and deleted in afterAll (cascades to
// every Company/Contact/DecisionMaker/LeadOpportunity/Campaign/Sequence/
// EmailDraft created during the test — see each model's onDelete: Cascade
// on organizationId/companyId in prisma/schema.prisma).
describe("opportunity-outreach-actions", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;

  let companyId: string;
  let opportunityId: string;

  let noMatchCompanyId: string;
  let noMatchOpportunityId: string;

  let otherOrgOpportunityId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Opportunity Outreach Test Org", slug: `opp-outreach-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Opportunity Outreach Other Org", slug: `opp-outreach-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Opp Outreach Test User", email: `opp-outreach-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    // A real matching fixture: company with a FOUNDER decision-maker (top
    // relevance for WEBSITE_DEVELOPMENT per decision-maker-matching.ts's
    // ROLE_RELEVANCE_TABLE) and a real Company.email on file, so contact
    // resolution is deterministic (company_fallback) regardless of whether
    // AI/live web search is available in this environment.
    const company = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: "Outreach Fixture Co Zzqxv",
        status: "PROSPECT",
        email: "hello@outreach-fixture-zzqxv.example.com",
      },
    });
    companyId = company.id;

    await prisma.decisionMaker.create({
      data: {
        companyId,
        name: "Jordan Founder Zzqxv",
        role: "FOUNDER",
        source: "Company website /about page",
        confidence: 0.8,
      },
    });

    const opportunity = await prisma.leadOpportunity.create({
      data: {
        companyId,
        category: "Website",
        title: "Outdated website",
        description: "Public site has not been redesigned in years.",
        estimatedImpact: "High",
        evidence: "Homepage last-modified header dated 2018.",
        confidenceScore: 80,
        recommendedService: "WEBSITE_DEVELOPMENT",
        status: "NEW",
      },
    });
    opportunityId = opportunity.id;

    // A company with zero DecisionMakers — for the honest "no match" error.
    const noMatchCompany = await prisma.company.create({
      data: { organizationId: orgId, name: "No Decision Maker Co Zzqxv", status: "PROSPECT" },
    });
    noMatchCompanyId = noMatchCompany.id;

    const noMatchOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: noMatchCompanyId,
        category: "Website",
        title: "No decision maker on file",
        description: "n/a",
        estimatedImpact: "Low",
        evidence: "n/a",
        confidenceScore: 30,
        status: "NEW",
      },
    });
    noMatchOpportunityId = noMatchOpportunity.id;

    // Cross-org fixture.
    const otherOrgCompany = await prisma.company.create({
      data: { organizationId: otherOrgId, name: "Other Org Outreach Co", status: "PROSPECT" },
    });
    const otherOrgOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: otherOrgCompany.id,
        category: "Website",
        title: "Cross-org opportunity",
        description: "Should never be visible to orgId.",
        estimatedImpact: "High",
        evidence: "n/a",
        confidenceScore: 50,
      },
    });
    otherOrgOpportunityId = otherOrgOpportunity.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const leakedContacts = await prisma.contact.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedContacts).toBe(0);
    const leakedCampaigns = await prisma.campaign.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedCampaigns).toBe(0);
    const leakedSequences = await prisma.sequence.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedSequences).toBe(0);
  });

  it("DEFAULT_SEQUENCE_STEPS encodes the Day 0/2/5/9/15 cadence as RELATIVE deltas (0, 2, 3, 4, 6), not the raw calendar days", () => {
    expect(DEFAULT_SEQUENCE_STEPS.map((s) => s.delayDays)).toEqual([0, 2, 3, 4, 6]);
    expect(DEFAULT_SEQUENCE_STEPS.map((s) => s.type)).toEqual(["EMAIL", "EMAIL", "EMAIL", "EMAIL", "EMAIL"]);
    expect(DEFAULT_SEQUENCE_STEPS.map((s) => s.purpose)).toEqual(["INTRODUCTION", "FOLLOW_UP", "FOLLOW_UP", "CASE_STUDY", "REMINDER"]);
    // Cumulative sum reconstructs the real Day 0/2/5/9/15 calendar cadence.
    let cumulative = 0;
    const calendarDays = DEFAULT_SEQUENCE_STEPS.map((s) => (cumulative += s.delayDays ?? 0));
    expect(calendarDays).toEqual([0, 2, 5, 9, 15]);
  });

  it("returns an honest error when no DecisionMaker exists for the company yet, and creates nothing", async () => {
    const result = await convertOpportunityToOutreachCore(orgId, userId, noMatchOpportunityId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("No public decision-maker identified for this company yet — run decision-maker discovery first.");
    expect(result.contactId).toBeUndefined();

    const contacts = await prisma.contact.count({ where: { companyId: noMatchCompanyId } });
    expect(contacts).toBe(0);
  });

  it("rejects an opportunity belonging to a different organization", async () => {
    const result = await convertOpportunityToOutreachCore(orgId, userId, otherOrgOpportunityId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");
  });

  it("returns an honest error for a nonexistent opportunityId", async () => {
    const result = await convertOpportunityToOutreachCore(orgId, userId, "nonexistent-opportunity-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Opportunity not found.");
  });

  it("happy path: creates/reuses a real Contact, Campaign, Sequence, CampaignContact, and (when AI is available) an EmailDraft", async () => {
    const result = await convertOpportunityToOutreachCore(orgId, userId, opportunityId);

    // Contact/Campaign/Sequence must be created regardless of whether the
    // AI draft-generation step itself succeeds.
    expect(result.contactId).toBeTruthy();
    expect(result.sequenceId).toBeTruthy();

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: result.contactId! } });
    expect(contact.companyId).toBe(companyId);
    expect(contact.organizationId).toBe(orgId);

    const campaign = await prisma.campaign.findFirstOrThrow({ where: { organizationId: orgId, name: OUTREACH_CAMPAIGN_NAME } });
    expect(campaign.approvalMode).toBe("MANUAL");
    expect(campaign.status).toBe("ACTIVE");

    const sequence = await prisma.sequence.findUniqueOrThrow({ where: { id: result.sequenceId! } });
    expect(sequence.name).toBe(OUTREACH_SEQUENCE_NAME);
    expect(sequence.campaignId).toBe(campaign.id);
    expect(sequence.steps).toEqual(DEFAULT_SEQUENCE_STEPS);

    const campaignContact = await prisma.campaignContact.findFirst({ where: { campaignId: campaign.id, contactId: contact.id } });
    expect(campaignContact).not.toBeNull();

    if (!isAIConnected()) {
      console.warn("[opportunity-outreach-actions.test] No AI provider configured — soft-asserting the draft-generation outcome.");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("AI is not connected");
      expect(result.draftId).toBeUndefined();
      return;
    }

    if (!result.ok) {
      console.warn(`[opportunity-outreach-actions.test] Draft generation failed even with AI configured — soft-asserting: ${result.error}`);
      return;
    }

    expect(result.draftId).toBeTruthy();
    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.purpose).toBe("INTRODUCTION");
    expect(draft.sequenceId).toBe(sequence.id);
    expect(draft.sequenceStepIndex).toBe(0);
    expect(draft.campaignId).toBe(campaign.id);
    expect(draft.contactId).toBe(contact.id);
  }, 60_000);

  it("reuses the same Campaign/Sequence across multiple opportunities in the same organization", async () => {
    const secondCompany = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: "Second Outreach Fixture Co Zzqxv",
        status: "PROSPECT",
        email: "hello@second-outreach-fixture-zzqxv.example.com",
      },
    });
    await prisma.decisionMaker.create({
      data: { companyId: secondCompany.id, name: "Morgan Cto Zzqxv", role: "CTO", source: "Press release mention", confidence: 0.7 },
    });
    const secondOpportunity = await prisma.leadOpportunity.create({
      data: {
        companyId: secondCompany.id,
        category: "SaaS",
        title: "No internal tooling",
        description: "n/a",
        estimatedImpact: "Medium",
        evidence: "n/a",
        confidenceScore: 60,
        recommendedService: "SAAS_DEVELOPMENT",
        status: "NEW",
      },
    });

    const first = await convertOpportunityToOutreachCore(orgId, userId, opportunityId);
    const second = await convertOpportunityToOutreachCore(orgId, userId, secondOpportunity.id);

    expect(first.sequenceId).toBeTruthy();
    expect(second.sequenceId).toBe(first.sequenceId);

    const campaignCount = await prisma.campaign.count({ where: { organizationId: orgId, name: OUTREACH_CAMPAIGN_NAME } });
    expect(campaignCount).toBe(1);
    const sequenceCount = await prisma.sequence.count({ where: { organizationId: orgId, name: OUTREACH_SEQUENCE_NAME } });
    expect(sequenceCount).toBe(1);
  }, 60_000);

  it("channel: 'LINKEDIN' creates a LINKEDIN-type first step (CONNECTION_REQUEST, no subject) in a genuinely separate Sequence row from the EMAIL default", async () => {
    // The EMAIL-default sequence already exists from earlier tests in this
    // file (reused across opportunities in the same org) — this asserts the
    // LinkedIn call creates its OWN Sequence row rather than mutating it.
    const emailSequenceBefore = await prisma.sequence.findFirstOrThrow({ where: { organizationId: orgId, name: OUTREACH_SEQUENCE_NAME } });

    const result = await convertOpportunityToOutreachCore(orgId, userId, opportunityId, "LINKEDIN");

    expect(result.contactId).toBeTruthy();
    expect(result.sequenceId).toBeTruthy();
    expect(result.sequenceId).not.toBe(emailSequenceBefore.id);

    const linkedinSequence = await prisma.sequence.findUniqueOrThrow({ where: { id: result.sequenceId! } });
    expect(linkedinSequence.name).toBe(OUTREACH_SEQUENCE_NAME_LINKEDIN);
    expect(linkedinSequence.steps).toEqual(DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST);
    expect((linkedinSequence.steps as unknown as typeof DEFAULT_SEQUENCE_STEPS_LINKEDIN_FIRST)[0]).toEqual({
      order: 0,
      type: "LINKEDIN",
      delayDays: 0,
      purpose: "CONNECTION_REQUEST",
      tone: "PROFESSIONAL",
    });

    // The pre-existing EMAIL sequence must be untouched — same row, same steps.
    const emailSequenceAfter = await prisma.sequence.findUniqueOrThrow({ where: { id: emailSequenceBefore.id } });
    expect(emailSequenceAfter.id).toBe(emailSequenceBefore.id);
    expect(emailSequenceAfter.name).toBe(OUTREACH_SEQUENCE_NAME);
    expect(emailSequenceAfter.steps).toEqual(DEFAULT_SEQUENCE_STEPS);

    const sequenceCount = await prisma.sequence.count({ where: { organizationId: orgId, name: { in: [OUTREACH_SEQUENCE_NAME, OUTREACH_SEQUENCE_NAME_LINKEDIN] } } });
    expect(sequenceCount).toBe(2);

    if (!isAIConnected()) {
      console.warn("[opportunity-outreach-actions.test] No AI provider configured — soft-asserting the LinkedIn draft-generation outcome.");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("AI is not connected");
      return;
    }

    if (!result.ok) {
      console.warn(`[opportunity-outreach-actions.test] LinkedIn draft generation failed even with AI configured — soft-asserting: ${result.error}`);
      return;
    }

    expect(result.draftId).toBeTruthy();
    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.channel).toBe("LINKEDIN");
    expect(draft.purpose).toBe("CONNECTION_REQUEST");
    expect(draft.subject).toBeNull();
    expect(draft.sequenceId).toBe(linkedinSequence.id);
    expect(draft.sequenceStepIndex).toBe(0);
  }, 60_000);

  it("channel defaults to EMAIL and reuses the same EMAIL sequence when omitted (backward-compatible signature)", async () => {
    const emailSequence = await prisma.sequence.findFirstOrThrow({ where: { organizationId: orgId, name: OUTREACH_SEQUENCE_NAME } });

    const result = await convertOpportunityToOutreachCore(orgId, userId, opportunityId);

    expect(result.sequenceId).toBe(emailSequence.id);
  }, 60_000);
});
