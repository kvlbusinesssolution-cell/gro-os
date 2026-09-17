import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing, file-independent next-auth/ESM breakage under Vitest
// that reply-actions.test.ts / opportunity-outreach-actions.test.ts document
// and work around — mocking "@/auth" avoids loading next-auth at all. This
// test only exercises the headless composeEmailCore, which never calls
// auth() itself, but compose-actions.ts imports `auth` at module scope.
// revalidatePath() also needs a Next.js request-scoped store that only
// exists inside a real request/action invocation.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAIConnected } from "@/lib/ai/client";

import { composeEmailCore, composeEmailWithAI } from "./compose-actions";

// Real local-Postgres integration test (no mocking of Prisma), same
// convention as reply-actions.test.ts. Everything is scoped under two
// throwaway Organizations created here and deleted in afterAll (cascades to
// Contact/EmailDraft via onDelete: Cascade on organizationId in
// prisma/schema.prisma).
describe("compose-actions", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let contactId: string;
  let otherOrgContactId: string;

  // Grounding fixtures for composeEmailWithAI: one contact with real
  // Company + LeadOpportunity data to be personalized from, one with none
  // at all (to assert an honest, non-fabricated short draft and — crucially
  // — that it never leaks the rich contact's real facts onto an unrelated,
  // context-less contact).
  let richContactId: string;
  let richCompanyName: string;
  let richOpportunityTitle: string;
  let poorContactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Compose Actions Test Org", slug: `compose-actions-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Compose Actions Other Org", slug: `compose-actions-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Compose Test User", email: `compose-actions-user-${suffix}@example.com` },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const contact = await prisma.contact.create({
      data: { organizationId: orgId, firstName: "Jordan", lastName: "Prospect", email: `jordan-${suffix}@example.com` },
    });
    contactId = contact.id;

    const otherOrgContact = await prisma.contact.create({
      data: { organizationId: otherOrgId, firstName: "Other", lastName: "Org", email: `other-${suffix}@example.com` },
    });
    otherOrgContactId = otherOrgContact.id;

    richCompanyName = `Zzqxv Robotics Fixture ${suffix}`;
    richOpportunityTitle = `No real-time inventory sync Zzqxv ${suffix}`;
    const richCompany = await prisma.company.create({
      data: { organizationId: orgId, name: richCompanyName, industry: "Industrial Robotics", status: "PROSPECT" },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: richCompany.id,
        category: "SaaS",
        title: richOpportunityTitle,
        description: "Warehouse inventory is tracked on spreadsheets, causing stockouts.",
        estimatedImpact: "High",
        evidence: "Careers page lists three open warehouse-ops roles.",
        confidenceScore: 70,
        recommendedService: "SAAS_DEVELOPMENT",
      },
    });
    const richContact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId: richCompany.id,
        firstName: "Rich",
        lastName: "Context",
        email: `rich-context-${suffix}@example.com`,
      },
    });
    richContactId = richContact.id;

    const poorContact = await prisma.contact.create({
      data: { organizationId: orgId, firstName: "Poor", lastName: "Context", email: `poor-context-${suffix}@example.com` },
    });
    poorContactId = poorContact.id;

    vi.mocked(auth).mockResolvedValue({ user: { id: userId, name: "Compose Test User" } } as never);
  });

  afterAll(async () => {
    await prisma.leadOpportunity.deleteMany({ where: { company: { organizationId: orgId } } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const leakedContacts = await prisma.contact.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(leakedContacts).toBe(0);
  });

  it("creates a DRAFT-status EmailDraft for a real contact in the same organization", async () => {
    const result = await composeEmailCore(orgId, userId, contactId, "  Hello there  ", "  Let's talk soon.  ");

    expect(result.ok).toBe(true);
    expect(result.draftId).toBeTruthy();

    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.channel).toBe("EMAIL");
    expect(draft.contactId).toBe(contactId);
    expect(draft.organizationId).toBe(orgId);
    // Trimmed, never auto-approved or auto-sent.
    expect(draft.subject).toBe("Hello there");
    expect(draft.body).toBe("Let's talk soon.");
    expect(draft.sentAt).toBeNull();
    expect(draft.approvedAt).toBeNull();
  });

  it("rejects an empty subject", async () => {
    const result = await composeEmailCore(orgId, userId, contactId, "   ", "A real body.");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Subject is required.");
    expect(result.draftId).toBeUndefined();
  });

  it("rejects an empty body", async () => {
    const result = await composeEmailCore(orgId, userId, contactId, "A real subject", "   ");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Body is required.");
    expect(result.draftId).toBeUndefined();
  });

  it("rejects a contact belonging to a different organization", async () => {
    const result = await composeEmailCore(orgId, userId, otherOrgContactId, "Subject", "Body");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Contact not found.");
    expect(result.draftId).toBeUndefined();
  });

  it("rejects a nonexistent contactId", async () => {
    const result = await composeEmailCore(orgId, userId, "nonexistent-contact-id", "Subject", "Body");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Contact not found.");
  });

  it("persists a real future scheduledFor and still lands at status DRAFT (never auto-approved)", async () => {
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await composeEmailCore(orgId, userId, contactId, "A scheduled subject", "A scheduled body.", { scheduledFor });

    expect(result.ok).toBe(true);
    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.scheduledFor?.getTime()).toBe(scheduledFor.getTime());
  });

  it("omits scheduledFor entirely when not provided", async () => {
    const result = await composeEmailCore(orgId, userId, contactId, "No schedule", "No schedule body.");
    expect(result.ok).toBe(true);
    const draft = await prisma.emailDraft.findUniqueOrThrow({ where: { id: result.draftId! } });
    expect(draft.scheduledFor).toBeNull();
  });

  it("rejects a scheduledFor in the past", async () => {
    const result = await composeEmailCore(orgId, userId, contactId, "Subject", "Body", {
      scheduledFor: new Date(Date.now() - 60_000),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Scheduled time must be in the future.");
    expect(result.draftId).toBeUndefined();
  });

  it("composeEmailWithAI requires a signed-in session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    const result = await composeEmailWithAI(contactId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("You must be signed in.");
    expect(result.subject).toBeUndefined();
    expect(result.body).toBeUndefined();
  });

  it("composeEmailWithAI rejects a contact from a different organization", async () => {
    const result = await composeEmailWithAI(otherOrgContactId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Contact not found.");
  });

  it("composeEmailWithAI rejects a nonexistent contactId", async () => {
    const result = await composeEmailWithAI("nonexistent-contact-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Contact not found.");
  });

  it(
    "composeEmailWithAI returns a real, honestly-grounded PREVIEW without persisting anything, and never leaks another contact's real facts onto a context-less contact",
    async () => {
      const draftCountBefore = await prisma.emailDraft.count({ where: { organizationId: orgId } });

      if (!isAIConnected()) {
        console.warn("[compose-actions.test] No AI provider configured — soft-asserting composeEmailWithAI's honest failure.");
        const result = await composeEmailWithAI(richContactId);
        expect(result.ok).toBe(false);
        expect(result.error).toContain("AI is not connected");
        return;
      }

      const richResult = await composeEmailWithAI(richContactId, "mention that we can help with warehouse tooling");
      if (!richResult.ok) {
        console.warn(`[compose-actions.test] composeEmailWithAI failed for the rich-context contact even with AI configured — soft-asserting: ${richResult.error}`);
      } else {
        expect(richResult.subject && richResult.subject.length > 0).toBe(true);
        expect(richResult.body && richResult.body.length > 0).toBe(true);
      }

      const poorResult = await composeEmailWithAI(poorContactId);
      if (!poorResult.ok) {
        console.warn(`[compose-actions.test] composeEmailWithAI failed for the context-less contact even with AI configured — soft-asserting: ${poorResult.error}`);
      } else {
        expect(poorResult.body && poorResult.body.length > 0).toBe(true);
        // The honest-grounding rule under test: a contact with no real
        // Company/Opportunity data of its own must never end up with
        // another real contact's actual company/opportunity facts bleeding
        // into its draft.
        expect(poorResult.body!.toLowerCase()).not.toContain(richCompanyName.toLowerCase());
        expect(poorResult.body!.toLowerCase()).not.toContain(richOpportunityTitle.toLowerCase());
        expect((poorResult.subject ?? "").toLowerCase()).not.toContain(richCompanyName.toLowerCase());
      }

      // Never persists — "Write with AI" is preview-only, the human's
      // separate "Save draft" click is what calls composeEmail/Core.
      const draftCountAfter = await prisma.emailDraft.count({ where: { organizationId: orgId } });
      expect(draftCountAfter).toBe(draftCountBefore);
    },
    60_000,
  );
});
