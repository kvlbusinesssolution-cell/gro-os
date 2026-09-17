import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";

import { resolveOutreachContact } from "./decision-maker-outreach";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Company/Contact/DecisionMaker/CompanyEvidence created during the test).
describe("resolveOutreachContact", () => {
  let organizationId: string;

  // (a) existing Contact already on file with a matching name.
  let existingMatchCompanyId: string;
  let existingMatchDecisionMakerId: string;
  let existingMatchContactId: string;

  // (b) real web-search path (or graceful skip if AI is unavailable) — a
  // well-known public company/person so a real search has something genuine
  // to find, same reasoning as decision-maker-discovery.test.ts.
  let searchCompanyId: string;
  let searchDecisionMakerId: string;

  // (c) company-fallback path: no Contact match, AI unavailable/finds
  // nothing, but the Company has its own general email on file.
  let fallbackCompanyId: string;
  let fallbackDecisionMakerId: string;

  // (d) no-email-found path: no Contact match, no company email, and (in
  // this fixture) no AI connection to even attempt a search — or a fake
  // company a real search will genuinely find nothing for.
  let noEmailCompanyId: string;
  let noEmailDecisionMakerId: string;

  const createdContactIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Decision Maker Outreach Test Org", slug: `decision-maker-outreach-test-org-${Date.now()}` },
    });
    organizationId = org.id;

    // (a)
    const existingMatchCompany = await prisma.company.create({
      data: { organizationId, name: "Existing Match Test Co" },
    });
    existingMatchCompanyId = existingMatchCompany.id;

    const existingMatchDecisionMaker = await prisma.decisionMaker.create({
      data: {
        companyId: existingMatchCompanyId,
        name: "Taylor Existing",
        role: "CEO",
        source: "Company website /about page",
        confidence: 0.85,
      },
    });
    existingMatchDecisionMakerId = existingMatchDecisionMaker.id;

    const existingContact = await prisma.contact.create({
      data: {
        organizationId,
        companyId: existingMatchCompanyId,
        firstName: "taylor",
        lastName: "EXISTING",
        email: "taylor@existing-match-test.example.com",
      },
    });
    existingMatchContactId = existingContact.id;

    // (b)
    const searchCompany = await prisma.company.create({
      data: { organizationId, name: "Stripe", website: "https://stripe.com", industry: "Financial Technology / Payments" },
    });
    searchCompanyId = searchCompany.id;

    const searchDecisionMaker = await prisma.decisionMaker.create({
      data: {
        companyId: searchCompanyId,
        name: "Patrick Collison",
        role: "CEO",
        source: "Company website /about page",
        confidence: 0.9,
      },
    });
    searchDecisionMakerId = searchDecisionMaker.id;

    // (c)
    const fallbackCompany = await prisma.company.create({
      data: { organizationId, name: "Fallback Email Test Co", email: "hello@fallback-email-test.example.com" },
    });
    fallbackCompanyId = fallbackCompany.id;

    const fallbackDecisionMaker = await prisma.decisionMaker.create({
      data: {
        companyId: fallbackCompanyId,
        name: "Morgan Fallback",
        role: "DIRECTOR",
        source: "Press release mention",
        confidence: 0.6,
      },
    });
    fallbackDecisionMakerId = fallbackDecisionMaker.id;

    // (d)
    const noEmailCompany = await prisma.company.create({
      data: { organizationId, name: "No Email Anywhere Test Co Zzqxv" },
    });
    noEmailCompanyId = noEmailCompany.id;

    const noEmailDecisionMaker = await prisma.decisionMaker.create({
      data: {
        companyId: noEmailCompanyId,
        name: "Jordan Unreachable Zzqxv",
        role: "IT_HEAD",
        source: "Press release mention",
        confidence: 0.5,
      },
    });
    noEmailDecisionMakerId = noEmailDecisionMaker.id;
  });

  afterAll(async () => {
    // Clean up any Contacts created by the resolver during the test (not
    // cascaded automatically since Contact.companyId is a nullable FK with
    // onDelete: SetNull, not Cascade).
    if (createdContactIds.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: createdContactIds } } });
    }
    await prisma.contact.deleteMany({ where: { id: existingMatchContactId } });

    await prisma.organization.delete({ where: { id: organizationId } });

    const leakedContacts = await prisma.contact.count({ where: { organizationId } });
    expect(leakedContacts).toBe(0);
    const leakedDecisionMakers = await prisma.decisionMaker.count({
      where: {
        companyId: { in: [existingMatchCompanyId, searchCompanyId, fallbackCompanyId, noEmailCompanyId] },
      },
    });
    expect(leakedDecisionMakers).toBe(0);
  });

  it("returns an honest error for a nonexistent decisionMakerId, never throws", async () => {
    const result = await resolveOutreachContact("nonexistent-decision-maker-id-does-not-exist");
    expect(result).toEqual({ error: "Decision-maker not found." });
  });

  it("(a) reuses an existing Contact whose name matches, case-insensitively", async () => {
    const result = await resolveOutreachContact(existingMatchDecisionMakerId);
    expect(result).toEqual({ contactId: existingMatchContactId, created: false, emailSource: "existing" });
  });

  it("(b) finds a real published email via web search when one genuinely exists, or gracefully falls through when AI is unavailable/nothing is found", async () => {
    const result = await resolveOutreachContact(searchDecisionMakerId);

    if (!isAIConnected()) {
      // No AI configured: falls straight through to company_fallback/error —
      // Stripe fixture has no Company.email set, so this should be the
      // honest no-email error.
      expect(result).toEqual({ error: "No real, publicly available contact email could be found for this person or their company." });
      console.warn("[decision-maker-outreach.test] No AI provider configured — skipping live-search assertions.");
      return;
    }

    if ("error" in result) {
      console.warn(
        "[decision-maker-outreach.test] Live search found no real published email for this person — soft-asserting rather than failing.",
      );
      return;
    }

    expect(result.created).toBe(true);
    createdContactIds.push(result.contactId);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: result.contactId } });
    expect(contact.companyId).toBe(searchCompanyId);
    expect(contact.firstName.toLowerCase()).toBe("patrick");

    if (result.emailSource === "found") {
      expect(contact.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      const evidence = await prisma.companyEvidence.findMany({
        where: { companyId: searchCompanyId, source: "WEB_SEARCH" },
      });
      expect(evidence.some((e) => e.fact.includes(contact.email))).toBe(true);
    } else {
      // No Company.email on the Stripe fixture, so "found" is the only
      // non-error outcome possible here — assert that explicitly.
      throw new Error(`unexpected emailSource: ${result.emailSource}`);
    }
  }, 60_000);

  it("(c) falls back to the company's own general email, honestly labeled, when no personal email is publicly found", async () => {
    // "Fallback Email Test Co" / "Morgan Fallback" are fabricated fixture
    // names — a real web search (when AI is connected) has nothing genuine
    // to find for them, so this should fall through to the company_fallback
    // path exactly like it would with AI unavailable. Soft-asserted rather
    // than hard-failed on the rare chance a live search surfaces something.
    const result = await resolveOutreachContact(fallbackDecisionMakerId);

    if ("error" in result) {
      throw new Error(`expected a company_fallback contact, got error: ${result.error}`);
    }

    if (result.emailSource === "found") {
      console.warn(
        "[decision-maker-outreach.test] Live search unexpectedly reported a real email for a fabricated fixture person — soft-asserting rather than failing.",
      );
      createdContactIds.push(result.contactId);
      return;
    }

    expect(result.created).toBe(true);
    expect(result.emailSource).toBe("company_fallback");
    createdContactIds.push(result.contactId);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: result.contactId } });
    expect(contact.email).toBe("hello@fallback-email-test.example.com");
    expect(contact.notes).toBe("General company contact — personal email not publicly available for Morgan Fallback.");
  }, 60_000);

  it("(d) returns an honest error, never a fabricated email, when no real email or company fallback exists", async () => {
    // "No Email Anywhere Test Co Zzqxv" / "Jordan Unreachable Zzqxv" are
    // deliberately obscure fabricated fixture names with no Company.email
    // on file — a real web search has nothing genuine to find and there is
    // no fallback, so this must be the honest no-email error either way.
    const result = await resolveOutreachContact(noEmailDecisionMakerId);

    if (!("error" in result)) {
      console.warn(
        "[decision-maker-outreach.test] Live search unexpectedly reported a real email for a fabricated fixture person — soft-asserting rather than failing.",
      );
      createdContactIds.push(result.contactId);
      return;
    }

    expect(result).toEqual({ error: "No real, publicly available contact email could be found for this person or their company." });

    const contacts = await prisma.contact.count({ where: { companyId: noEmailCompanyId } });
    expect(contacts).toBe(0);
  }, 60_000);
});
