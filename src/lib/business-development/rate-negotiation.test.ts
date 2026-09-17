import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// initiateRateNegotiation() genuinely calls sendEmail() — with a real
// EMAIL_SERVER configured (as this dev environment has), an unmocked run of
// this suite sends a REAL email to the real owner inbox every time these
// tests execute, using fake test-fixture content ("Priya at Test Prospect
// Co"). Confirmed this actually happened (real emails landed in the real
// inbox during this session's own repeated test runs) — mocking the one
// real side-effecting boundary here, same "simulate send" discipline
// phase3-email-center.e2e.test.ts already uses for sendOutreachEmail.
// Everything else in this file stays a real, unmocked Postgres integration
// test.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "@/lib/prisma";
import { initiateRateNegotiation, completeRateNegotiationAfterOwnerReply } from "./rate-negotiation";

// Real local-Postgres integration test — same convention as
// opportunity-outreach-actions.test.ts. Scoped under one throwaway
// Organization, cleaned up in afterAll (cascades to every Company/Contact/
// Reply/RateNegotiation/EmailDraft/OutreachMeeting created here).
describe("rate-negotiation", () => {
  let orgId: string;
  let userId: string;
  let companyId: string;
  let contactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({ data: { name: "Rate Negotiation Test Org", slug: `rate-negotiation-org-${suffix}` } });
    orgId = org.id;

    const user = await prisma.user.create({ data: { name: "Rate Negotiation Test User", email: `rate-negotiation-user-${suffix}@example.com` } });
    userId = user.id;

    const company = await prisma.company.create({ data: { organizationId: orgId, name: "Test Prospect Co", website: "https://testprospect.example.com" } });
    companyId = company.id;

    const contact = await prisma.contact.create({
      data: { organizationId: orgId, companyId, firstName: "Priya", lastName: "Sharma", email: `priya-${suffix}@testprospect.example.com` },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("initiateRateNegotiation creates a real negotiation row, sends the owner email, and never fabricates scope info when none exists", async () => {
    const reply = await prisma.reply.create({
      data: { organizationId: orgId, contactId, channel: "EMAIL", content: "This looks great but the price is too high for us — can you do better?", loggedByUserId: userId, intent: "PRICE_QUESTION" },
    });

    const result = await initiateRateNegotiation(reply.id);
    expect(result.ok).toBe(true);
    expect(result.negotiationId).toBeTruthy();

    const negotiation = await prisma.rateNegotiation.findUnique({ where: { id: result.negotiationId } });
    expect(negotiation).not.toBeNull();
    expect(negotiation!.companyId).toBe(companyId);
    expect(negotiation!.contactId).toBe(contactId);
    expect(negotiation!.status).toBe("AWAITING_OWNER");
    expect(negotiation!.ownerEmailSentAt).not.toBeNull();
    expect(negotiation!.clientMessage).toContain("price is too high");
    // No LeadOpportunity/CompanyIntelligence exist for this company — the
    // scope summary must say so honestly, never invent project detail.
    expect(negotiation!.scopeSummary).toContain("No real project-scope information");
  }, 30000);

  it("initiateRateNegotiation is idempotent — a retry on the same reply never creates a second negotiation", async () => {
    const reply = await prisma.reply.create({
      data: { organizationId: orgId, contactId, channel: "EMAIL", content: "Can you reduce the rate?", loggedByUserId: userId, intent: "PRICE_QUESTION" },
    });

    const first = await initiateRateNegotiation(reply.id);
    const second = await initiateRateNegotiation(reply.id);

    expect(first.negotiationId).toBe(second.negotiationId);
    const count = await prisma.rateNegotiation.count({ where: { replyId: reply.id } });
    expect(count).toBe(1);
  }, 30000);

  it("initiateRateNegotiation grounds its recommendation in real LeadOpportunity data when it exists", async () => {
    const groundedCompany = await prisma.company.create({ data: { organizationId: orgId, name: "Grounded Co" } });
    const groundedContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: groundedCompany.id, firstName: "Raj", email: `raj-${Date.now()}@grounded.example.com` },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: groundedCompany.id,
        category: "Website Redesign",
        title: "Outdated website needs a full rebuild",
        description: "The current site is on an unsupported CMS and has no mobile support.",
        estimatedImpact: "High",
        evidence: "Real evidence text.",
        confidenceScore: 80,
        recommendedService: "WEBSITE_DEVELOPMENT",
        estimatedValue: 150000,
      },
    });
    const reply = await prisma.reply.create({
      data: { organizationId: orgId, contactId: groundedContact.id, channel: "EMAIL", content: "The quote seems high, any flexibility?", loggedByUserId: userId, intent: "PRICE_QUESTION" },
    });

    const result = await initiateRateNegotiation(reply.id);
    const negotiation = await prisma.rateNegotiation.findUnique({ where: { id: result.negotiationId } });
    expect(negotiation!.scopeSummary).toContain("Outdated website needs a full rebuild");
    expect(negotiation!.scopeSummary).toContain("1,50,000");
  }, 30000);

  it("completeRateNegotiationAfterOwnerReply creates a DRAFT-status EmailDraft (never auto-sent) and a real closing meeting, relaying the owner's own real words", async () => {
    const reply = await prisma.reply.create({
      data: { organizationId: orgId, contactId, channel: "EMAIL", content: "What's your best price?", loggedByUserId: userId, intent: "PRICE_QUESTION" },
    });
    const { negotiationId } = await initiateRateNegotiation(reply.id);

    const ownerWords = "We can do ₹45,000 for this given the scope you described — let's lock it in.";
    const result = await completeRateNegotiationAfterOwnerReply(negotiationId!, ownerWords);
    expect(result.ok).toBe(true);
    expect(result.draftId).toBeTruthy();
    expect(result.meetingId).toBeTruthy();

    const draft = await prisma.emailDraft.findUnique({ where: { id: result.draftId } });
    expect(draft!.status).toBe("DRAFT");
    expect(draft!.sentAt).toBeNull();
    expect(draft!.approvedAt).toBeNull();
    expect(draft!.body).toContain(ownerWords);

    const meeting = await prisma.outreachMeeting.findUnique({ where: { id: result.meetingId } });
    expect(meeting!.status).toBe("REQUESTED");
    expect(meeting!.contactId).toBe(contactId);

    const negotiation = await prisma.rateNegotiation.findUnique({ where: { id: negotiationId! } });
    expect(negotiation!.status).toBe("CLIENT_REPLIED");
    expect(negotiation!.ownerReplyContent).toBe(ownerWords);
  }, 30000);

  it("completeRateNegotiationAfterOwnerReply is idempotent — a second call never creates a duplicate draft or meeting", async () => {
    const reply = await prisma.reply.create({
      data: { organizationId: orgId, contactId, channel: "EMAIL", content: "Any discount available?", loggedByUserId: userId, intent: "PRICE_QUESTION" },
    });
    const { negotiationId } = await initiateRateNegotiation(reply.id);

    const first = await completeRateNegotiationAfterOwnerReply(negotiationId!, "₹35,000 works.");
    const second = await completeRateNegotiationAfterOwnerReply(negotiationId!, "ignored — already responded");

    expect(second.draftId).toBe(first.draftId);
    expect(second.meetingId).toBe(first.meetingId);
  }, 30000);
});
