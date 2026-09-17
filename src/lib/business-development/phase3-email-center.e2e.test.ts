import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same pre-existing next-auth/ESM breakage under Vitest that every other
// Server-Action integration test in this repo mocks around (see
// compose-actions.test.ts) — composeEmailCore doesn't call auth() itself,
// but compose-actions.ts imports `auth` at module scope, and
// composeEmailCore calls revalidatePath(), which needs a real Next.js
// request-scoped store that only exists inside an actual request/action
// invocation.
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { composeEmailCore } from "@/app/dashboard/outreach/_lib/compose-actions";
import {
  getInboxThreads,
  getContactTimeline,
  getSentEmails,
  markReplyAsRead,
  searchEmailCenter,
} from "@/lib/outreach/inbox";
import { getEmailCrmBreadcrumb } from "@/lib/outreach/email-crm-breadcrumb";
import { getCompanyCompleteTimeline } from "@/lib/business-development/company-complete-timeline";
import { suggestNextActionForCompany } from "@/lib/business-development/company-next-action";
import { summarizeCompanyConversation } from "@/lib/business-development/company-conversation-summary";
import { askAiAboutClient } from "@/lib/business-development/ask-ai-about-client";
import { computeRevenueCommandCenterToday } from "@/lib/business-development/revenue-command-center";
import { getTodaysClientConversations } from "@/lib/business-development/todays-client-conversations";
import { runScheduledEmailSend } from "@/lib/business-development/scheduled-send-job";

/**
 * Real, end-to-end verification of the Phase 3 "Email + Complete Client
 * Conversation Center" chain — Company -> LeadOpportunity -> DecisionMaker
 * -> EmailDraft (DRAFT -> APPROVED -> SENT) -> Reply -> read-state ->
 * CRM breadcrumb -> OutreachMeeting/Proposal/Deal -> complete timeline ->
 * next-action heuristic -> (if AI connected) AI summary/Q&A grounding ->
 * search. Real Postgres, no mocking beyond the usual @/auth / next/cache
 * shims this repo's Server-Action tests use. Everything lives under two
 * throwaway Organizations created here and deleted in afterAll.
 */
describe("Phase 3 Email Center — real end-to-end chain", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let companyId: string;
  let contactId: string;
  let workspaceId: string;
  let dealStageId: string;

  // A decoy company/price seeded in the SAME org but on a totally different
  // company/contact — the concrete anti-fabrication check: an AI answer
  // scoped to `companyId` must never leak this decoy's real facts.
  let decoyCompanyName: string;
  let decoyPriceText: string;

  let opportunityId: string;
  let decisionMakerId: string;
  let draftId: string;
  let replyId: string;
  let meetingId: string;
  let proposalId: string;
  let dealId: string;

  const emailBodySubstring = `warehouse-inventory-sync-fixture`;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Phase3 E2E Org", slug: `phase3-e2e-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Phase3 E2E Other Org", slug: `phase3-e2e-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Phase3 E2E User", email: `phase3-e2e-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: `Phase3 Fixture Co ${suffix}`, industry: "Industrial Robotics", status: "PROSPECT" },
    });
    companyId = company.id;

    const contact = await prisma.contact.create({
      data: { organizationId: orgId, companyId, firstName: "Priya", lastName: "Fixture", email: `priya-${suffix}@example.com` },
    });
    contactId = contact.id;

    // Decoy: unrelated company + a real price, seeded in the SAME
    // organization but never linked to `companyId`/`contactId` above — the
    // anti-fabrication assertion checks this never bleeds into an AI answer
    // scoped to the real company.
    decoyCompanyName = `Zzqxv Decoy Robotics ${suffix}`;
    decoyPriceText = "₹47,50,000";
    const decoyCompany = await prisma.company.create({
      data: { organizationId: orgId, name: decoyCompanyName, industry: "Unrelated Decoy Industry", status: "PROSPECT" },
    });
    const decoyContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: decoyCompany.id, firstName: "Decoy", lastName: "Contact", email: `decoy-${suffix}@example.com` },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: decoyContact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Decoy quote",
        body: `We quoted ${decoyCompanyName} at ${decoyPriceText} for an unrelated ERP project.`,
        status: "SENT",
        sentAt: new Date(suffix - 60_000),
      },
    });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Phase3 E2E Workspace" } });
    workspaceId = workspace.id;
    const dealStage = await prisma.dealStage.create({ data: { workspaceId, name: "Negotiation", order: 0 } });
    dealStageId = dealStage.id;
  });

  afterAll(async () => {
    await prisma.rateNegotiation.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.deal.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.dealStage.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.proposal.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.outreachMeeting.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.approval.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.reply.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.decisionMaker.deleteMany({ where: { company: { organizationId: { in: [orgId, otherOrgId] } } } });
    await prisma.leadOpportunity.deleteMany({ where: { company: { organizationId: { in: [orgId, otherOrgId] } } } });
    await prisma.contact.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.company.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });
    await prisma.user.delete({ where: { id: userId } });

    const leakedContacts = await prisma.contact.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedContacts).toBe(0);
  });

  it("Step 1: LeadOpportunity created with real fields", async () => {
    const opportunity = await prisma.leadOpportunity.create({
      data: {
        companyId,
        category: "SaaS",
        title: "No real-time inventory sync",
        description: "Warehouse inventory is tracked on spreadsheets, causing stockouts.",
        estimatedImpact: "High",
        estimatedValue: 850_000,
        evidence: "Careers page lists three open warehouse-ops roles.",
        confidenceScore: 70,
        recommendedService: "SAAS_DEVELOPMENT",
      },
    });
    opportunityId = opportunity.id;
    expect(opportunity.companyId).toBe(companyId);
  });

  it("Step 2: DecisionMaker created", async () => {
    const dm = await prisma.decisionMaker.create({
      data: {
        companyId,
        name: "Arjun Fixture",
        role: "CTO",
        source: "LinkedIn",
        confidence: 0.8,
      },
    });
    decisionMakerId = dm.id;
    expect(dm.companyId).toBe(companyId);
  });

  it("Step 3: EmailDraft created via composeEmailCore lands at status DRAFT", async () => {
    const result = await composeEmailCore(
      orgId,
      userId,
      contactId,
      "Introducing a real-time inventory sync solution",
      `Hi Priya — following up on the ${emailBodySubstring} gap we noticed on your careers page. Happy to walk you through a fix.`,
    );
    expect(result.ok).toBe(true);
    expect(result.draftId).toBeTruthy();
    draftId = result.draftId!;

    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.organizationId).toBe(orgId);
    expect(draft.contactId).toBe(contactId);
  });

  it("Step 4: simulated approval — Approval row + status APPROVED", async () => {
    await prisma.approval.create({
      data: {
        organizationId: orgId,
        emailDraftId: draftId,
        decision: "APPROVED",
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "APPROVED", approvedByUserId: userId, approvedAt: new Date() } });

    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("APPROVED");
  });

  it("Step 5: simulated send — status SENT, sentAt set — and it now appears in getSentEmails", async () => {
    const sentAt = new Date();
    await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "SENT", sentAt } });

    const sent = await getSentEmails(orgId);
    const found = sent.find((d) => d.id === draftId);
    expect(found).toBeTruthy();
    expect(found!.status).toBe("SENT");
    expect(found!.sentAt).toBeTruthy();
  });

  it("Step 6: a real Reply (with intent/sentiment set, simulating IMAP capture) appears unread in getInboxThreads and interleaved correctly in getContactTimeline", async () => {
    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draftId } });
    const receivedAt = new Date(draft.sentAt!.getTime() + 60_000);

    const reply = await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId,
        emailDraftId: draftId,
        channel: "EMAIL",
        content: "Thanks for reaching out — yes, this is a real problem for us, can we set up a call?",
        sentiment: "POSITIVE",
        intent: "REQUEST_CALL",
        intentConfidence: 0.9,
        loggedByUserId: userId,
        receivedAt,
      },
    });
    replyId = reply.id;

    const threads = await getInboxThreads(orgId);
    const thread = threads.find((t) => t.contact.id === contactId);
    expect(thread).toBeTruthy();
    expect(thread!.unread).toBe(true);
    expect(thread!.unreadPersisted).toBe(true);
    expect(thread!.intent).toBe("REQUEST_CALL");
    expect(thread!.sentiment).toBe("POSITIVE");

    const timeline = await getContactTimeline(orgId, contactId);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].type).toBe("DRAFT");
    expect(timeline[1].type).toBe("REPLY");
    if (timeline[0].type === "DRAFT" && timeline[1].type === "REPLY") {
      expect(timeline[0].draft.id).toBe(draftId);
      expect(timeline[1].reply.id).toBe(replyId);
      expect(timeline[0].draft.sentAt!.getTime()).toBeLessThan(timeline[1].reply.receivedAt.getTime());
    }
  });

  it("Step 7: markReplyAsRead flips unreadPersisted", async () => {
    await markReplyAsRead(replyId, orgId);

    const reply = await prisma.reply.findUniqueOrThrow({ where: { id: replyId } });
    expect(reply.readAt).not.toBeNull();

    const threads = await getInboxThreads(orgId);
    const thread = threads.find((t) => t.contact.id === contactId);
    expect(thread!.unreadPersisted).toBe(false);
  });

  it("Step 8: getEmailCrmBreadcrumb shows the real Company/Opportunity", async () => {
    const breadcrumb = await getEmailCrmBreadcrumb(orgId, contactId);
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb!.company?.id).toBe(companyId);
    expect(breadcrumb!.leadOpportunities.map((o) => o.id)).toContain(opportunityId);
  });

  it("Step 9: OutreachMeeting, Proposal, Deal created on this company", async () => {
    const meeting = await prisma.outreachMeeting.create({
      data: { organizationId: orgId, contactId, title: "Discovery call — inventory sync", status: "REQUESTED" },
    });
    meetingId = meeting.id;

    const proposal = await prisma.proposal.create({
      data: { organizationId: orgId, companyId, title: "Inventory Sync Proposal", content: "Real proposal content.", status: "SENT", value: 850_000 },
    });
    proposalId = proposal.id;

    const deal = await prisma.deal.create({
      data: { organizationId: orgId, dealStageId, companyId, contactId, name: "Inventory Sync Deal", value: 850_000 },
    });
    dealId = deal.id;

    expect(meeting.contactId).toBe(contactId);
    expect(proposal.companyId).toBe(companyId);
    expect(deal.companyId).toBe(companyId);
  });

  it("Step 10: getCompanyCompleteTimeline includes every real event, chronologically ordered, each with a real-or-null linkHref", async () => {
    const timeline = await getCompanyCompleteTimeline(orgId, companyId);

    const types = timeline.map((e) => e.type);
    for (const expectedType of [
      "company_discovered",
      "email_drafted",
      "email_sent",
      "reply_received",
      "reply_classified",
      "opportunity_detected",
      "decision_maker_identified",
      "meeting_requested",
      "proposal_generated",
      "deal_created",
    ]) {
      expect(types).toContain(expectedType);
    }

    // Chronological order (ascending occurredAt).
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].occurredAt.getTime()).toBeGreaterThanOrEqual(timeline[i - 1].occurredAt.getTime());
    }

    // Every entry's linkHref is either a real, honest null or a non-empty string — never "#" or empty.
    for (const entry of timeline) {
      if (entry.linkHref !== null) {
        expect(entry.linkHref.length).toBeGreaterThan(0);
        expect(entry.linkHref).not.toBe("#");
      }
    }

    const dealEntry = timeline.find((e) => e.type === "deal_created");
    expect(dealEntry?.linkHref).toBe(`/dashboard/crm/deals/${dealId}`);
    const proposalEntry = timeline.find((e) => e.type === "proposal_generated");
    expect(proposalEntry?.linkHref).toBe(`/dashboard/proposal/proposals/${proposalId}`);
    const dmEntry = timeline.find((e) => e.type === "decision_maker_identified");
    expect(dmEntry?.recordId).toBe(decisionMakerId);
    expect(dmEntry?.linkHref).toBeNull(); // honest — no standalone decision-maker page exists.
  });

  it("Step 11: suggestNextActionForCompany returns a real, non-fabricated action", async () => {
    const result = await suggestNextActionForCompany(orgId, companyId);
    // No Task exists yet after this reply, so this must be the deterministic
    // fallback for REQUEST_CALL — never a generic/fabricated string.
    expect(result.action).toBe("Schedule a call with the client");
    expect(result.taskId).toBeNull();
  });

  it("Step 12 (only if AI connected): summarizeCompanyConversation and askAiAboutClient are grounded — never mention the decoy company/price", async () => {
    if (!isAIConnected()) {
      console.warn("[phase3-e2e] No AI provider configured — skipping AI-grounding assertions.");
      return;
    }

    const summary = await summarizeCompanyConversation(orgId, companyId);
    expect(summary).not.toBeNull();
    if (summary) {
      const summaryText = JSON.stringify(summary).toLowerCase();
      expect(summaryText).not.toContain(decoyCompanyName.toLowerCase());
      expect(summaryText).not.toContain(decoyPriceText.toLowerCase());
    }

    const qa = await askAiAboutClient(orgId, companyId, "Has the client asked for a call, and what did we send them?");
    expect(qa).not.toBeNull();
    if (qa) {
      expect(qa.answer.toLowerCase()).not.toContain(decoyCompanyName.toLowerCase());
      expect(qa.answer.toLowerCase()).not.toContain(decoyPriceText.toLowerCase());
    }
  }, 60_000);

  it("Step 13: searchEmailCenter finds a real substring from the seeded email body", async () => {
    const result = await searchEmailCenter(orgId, emailBodySubstring);
    expect(result.totalCount).toBeGreaterThan(0);
    const match = result.items.find((r) => r.type === "DRAFT" && r.draft.id === draftId);
    expect(match).toBeTruthy();
  });

  it("Step 14: composeEmailCore persists real Cc/Bcc recipients intact (Phase 3 CC/BCC extension), trimmed/lowercased/de-duplicated", async () => {
    const ccBccContact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "CcBcc",
        lastName: "Fixture",
        email: `ccbcc-${Date.now()}@example.com`,
      },
    });

    const result = await composeEmailCore(orgId, userId, ccBccContact.id, "Cc/Bcc coverage test", "Body text for cc/bcc coverage.", {
      cc: ["  Manager@Example.com ", "manager@example.com"],
      bcc: ["archive@example.com"],
    });
    expect(result.ok).toBe(true);

    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.cc).toEqual(["manager@example.com"]);
    expect(draft.bcc).toEqual(["archive@example.com"]);
  });

  it("Step 15: a due scheduled draft for an UNSUBSCRIBED contact is never sent, and is failed with an honest reason (scheduled-send-job)", async () => {
    const unsubContact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "Unsub",
        lastName: "Fixture",
        email: `unsub-sched-${Date.now()}@example.com`,
        status: "UNSUBSCRIBED",
      },
    });
    const dueDraft = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: unsubContact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Should never send",
        body: "This must never actually send.",
        status: "APPROVED",
        scheduledFor: new Date(Date.now() - 60_000),
      },
    });

    await runScheduledEmailSend();

    const updated = await prisma.emailDraft.findUniqueOrThrow({ where: { id: dueDraft.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.failedReason).toContain("unsubscribed");
    expect(updated.queuedAt).toBeNull();
    expect(updated.sentAt).toBeNull();
  });

  it("Step 16: Revenue Command Center's 'today' tile counts match real, independently-recomputed DB counts for this exact org", async () => {
    const today = await computeRevenueCommandCenterToday(orgId);

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [aiCount, humanCount, deliveredCount] = await Promise.all([
      prisma.emailDraft.count({ where: { organizationId: orgId, generatedByAgentId: { not: null }, createdAt: { gte: dayStart } } }),
      prisma.emailDraft.count({ where: { organizationId: orgId, generatedByAgentId: null, createdAt: { gte: dayStart } } }),
      prisma.emailDraft.count({ where: { organizationId: orgId, status: "SENT", bouncedAt: null, sentAt: { gte: dayStart } } }),
    ]);

    expect(today.aiDraftsCreated).toBe(aiCount);
    expect(today.humanDraftsCreated).toBe(humanCount);
    expect(today.delivered).toBe(deliveredCount);
    // This exact chain composed several real human drafts today (Step 3, Step 14) — never zero.
    expect(today.humanDraftsCreated).toBeGreaterThan(0);
  });

  it("Step 17: getTodaysClientConversations surfaces today's real activity from this exact chain, with its real opportunity/deal attached", async () => {
    const rows = await getTodaysClientConversations(orgId);
    const row = rows.find((r) => r.contact.id === contactId);
    expect(row).toBeDefined();
    expect(row!.lastReplyPreview).toContain("real problem");
    expect(row!.opportunity?.id).toBe(opportunityId);
    expect(row!.deal?.id).toBe(dealId);
  });

  it("Tenant isolation: a second, unrelated Organization sees none of this data", async () => {
    const otherThreads = await getInboxThreads(otherOrgId);
    expect(otherThreads.find((t) => t.contact.id === contactId)).toBeUndefined();

    const otherTimeline = await getContactTimeline(otherOrgId, contactId);
    expect(otherTimeline).toEqual([]);

    const otherBreadcrumb = await getEmailCrmBreadcrumb(otherOrgId, contactId);
    expect(otherBreadcrumb).toBeNull();

    const otherCompanyTimeline = await getCompanyCompleteTimeline(otherOrgId, companyId);
    expect(otherCompanyTimeline).toEqual([]);

    const otherNextAction = await suggestNextActionForCompany(otherOrgId, companyId);
    expect(otherNextAction).toEqual({ action: "Company not found.", taskId: null });
  });
});
