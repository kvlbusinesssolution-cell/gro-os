import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// contact-actions.ts imports `auth` from "@/auth" at module scope — the same
// pre-existing Next.js 16 / next-auth ESM resolution issue under Vitest
// documented in companies/actions.test.ts. Mocked here for the same reason.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createContact, updateContact, deleteContact } from "./contact-actions";

// Real local-Postgres integration test, same convention as
// companies/actions.test.ts. Covers Phase 25's new RBAC gate on
// updateContact/deleteContact, and createContact's new dedup-routing.
describe("contact-actions: RBAC + dedup routing (Phase 25)", () => {
  let orgId: string;
  let ownerUserId: string;
  let memberUserId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Contact Actions Test Org", slug: `contact-actions-org-${suffix}` } });
    orgId = org.id;

    const owner = await prisma.user.create({ data: { name: "Owner", email: `contact-actions-owner-${suffix}@example.com` } });
    ownerUserId = owner.id;
    await prisma.membership.create({ data: { userId: ownerUserId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const member = await prisma.user.create({ data: { name: "Member", email: `contact-actions-member-${suffix}@example.com` } });
    memberUserId = member.id;
    await prisma.membership.create({ data: { userId: memberUserId, organizationId: orgId, role: "SALES", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("createContact routes through findOrCreateContact — re-submitting the same email is a no-op, never a duplicate", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: ownerUserId } } as never);

    const input = {
      firstName: "Dedup",
      lastName: "Test",
      email: "dedup-via-action@example.com",
      status: "NEW" as const,
      tags: [],
    };

    const first = await createContact(input);
    expect(first.ok).toBe(true);
    const second = await createContact(input);
    expect(second.ok).toBe(true);
    expect(second.contactId).toBe(first.contactId);

    const rows = await prisma.contact.findMany({ where: { organizationId: orgId, email: "dedup-via-action@example.com" } });
    expect(rows).toHaveLength(1);
  });

  it("updateContact: a MEMBER (non-Owner/Admin) is denied — real permission failure", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: ownerUserId } } as never);
    const created = await createContact({ firstName: "Edit", lastName: "Target", email: "edit-target@example.com", status: "NEW", tags: [] });
    expect(created.ok).toBe(true);

    vi.mocked(auth).mockResolvedValue({ user: { id: memberUserId } } as never);
    const result = await updateContact(created.contactId!, {
      firstName: "Edited",
      lastName: "Target",
      email: "edit-target@example.com",
      status: "NEW",
      tags: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Owner or Admin/);

    const unchanged = await prisma.contact.findUniqueOrThrow({ where: { id: created.contactId! } });
    expect(unchanged.firstName).toBe("Edit"); // real proof nothing changed
  });

  it("updateContact: an OWNER can edit", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: ownerUserId } } as never);
    const created = await createContact({ firstName: "Owner", lastName: "Edits", email: "owner-edits@example.com", status: "NEW", tags: [] });

    const result = await updateContact(created.contactId!, {
      firstName: "Owner Edited",
      lastName: "Edits",
      email: "owner-edits@example.com",
      status: "NEW",
      tags: [],
    });
    expect(result.ok).toBe(true);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: created.contactId! } });
    expect(updated.firstName).toBe("Owner Edited");
  });

  it("deleteContact: a MEMBER is denied — real permission failure", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: ownerUserId } } as never);
    const created = await createContact({ firstName: "Delete", lastName: "Target", email: "delete-target@example.com", status: "NEW", tags: [] });

    vi.mocked(auth).mockResolvedValue({ user: { id: memberUserId } } as never);
    const result = await deleteContact(created.contactId!);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Owner or Admin/);

    const stillExists = await prisma.contact.findUnique({ where: { id: created.contactId! } });
    expect(stillExists).not.toBeNull();
  });
});
