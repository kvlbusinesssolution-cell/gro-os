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

import { composeEmailCore } from "./compose-actions";

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
  });

  afterAll(async () => {
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
});
