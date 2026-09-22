"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { contactSchema, type ContactInput, type ContactStatusInput } from "@/lib/validations/outreach";
import { findOrCreateContact } from "@/lib/business-development/dedup";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Phase 25 (RBAC): same OWNER/ADMIN bar as Company edit/delete (Phase 24).
const EDITOR_ROLES = new Set(["OWNER", "ADMIN"]);

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveContactInOrg(userId: string, contactId: string) {
  const membership = await resolveActiveMembership(userId);
  if (!membership) return null;
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return null;
  return { membership, contact };
}

export interface CreateContactResult extends ActionResult {
  contactId?: string;
}

export async function createContact(input: ContactInput): Promise<CreateContactResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the contact details." };
  }

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  try {
    // Phase 25 (dedup-bypass fix): routed through the real single choke
    // point instead of a direct prisma.contact.create() — re-adding a
    // contact whose email already exists in this org now reuses/updates
    // that row instead of creating a real duplicate.
    const { contact, wasCreated } = await findOrCreateContact({
      organizationId: membership.organizationId,
      companyId: parsed.data.companyId || null,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName || null,
      email: parsed.data.email,
      jobTitle: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
      tags: parsed.data.tags ?? [],
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      linkedin: parsed.data.linkedin || null,
      department: parsed.data.department || null,
      relationshipScore: parsed.data.relationshipScore ?? null,
    });

    if (wasCreated) {
      await logAudit({ userId, organizationId: membership.organizationId, action: "outreach.contact_created", metadata: { contactId: contact.id } });
    }
    revalidatePath("/dashboard/outreach/contacts");
    revalidatePath("/dashboard/crm/contacts");
    return { ok: true, contactId: contact.id };
  } catch (error) {
    console.error("[outreach] createContact failed:", error);
    return { ok: false, error: "Something went wrong creating the contact. Please try again." };
  }
}

export async function updateContact(contactId: string, input: ContactInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the contact details." };
  }

  const resolved = await resolveContactInOrg(userId, contactId);
  if (!resolved) return { ok: false, error: "Contact not found." };
  if (!EDITOR_ROLES.has(resolved.membership.role)) {
    return { ok: false, error: "Only an Owner or Admin can edit a contact." };
  }

  try {
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        companyId: parsed.data.companyId || null,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName || null,
        email: parsed.data.email,
        jobTitle: parsed.data.jobTitle || null,
        phone: parsed.data.phone || null,
        country: parsed.data.country || null,
        city: parsed.data.city || null,
        tags: parsed.data.tags ?? [],
        status: parsed.data.status,
        notes: parsed.data.notes || null,
        linkedin: parsed.data.linkedin || null,
        department: parsed.data.department || null,
        relationshipScore: parsed.data.relationshipScore ?? null,
      },
    });

    await logAudit({ userId, organizationId: resolved.membership.organizationId, action: "outreach.contact_updated", metadata: { contactId } });
    revalidatePath("/dashboard/outreach/contacts");
    revalidatePath(`/dashboard/outreach/contacts/${contactId}`);
    revalidatePath("/dashboard/crm/contacts");
    return { ok: true };
  } catch (error) {
    console.error("[outreach] updateContact failed:", error);
    return { ok: false, error: "Something went wrong updating the contact. Please try again." };
  }
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveContactInOrg(userId, contactId);
  if (!resolved) return { ok: false, error: "Contact not found." };
  if (!EDITOR_ROLES.has(resolved.membership.role)) {
    return { ok: false, error: "Only an Owner or Admin can delete a contact." };
  }

  await prisma.contact.delete({ where: { id: contactId } });
  await logAudit({ userId, organizationId: resolved.membership.organizationId, action: "outreach.contact_deleted", metadata: { contactId } });
  revalidatePath("/dashboard/outreach/contacts");
  revalidatePath("/dashboard/crm/contacts");
  return { ok: true };
}

export async function assignContactOwner(contactId: string, ownerUserId: string | null): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveContactInOrg(userId, contactId);
  if (!resolved) return { ok: false, error: "Contact not found." };

  if (ownerUserId) {
    const ownerMembership = await prisma.membership.findFirst({
      where: { userId: ownerUserId, organizationId: resolved.membership.organizationId, status: "ACTIVE" },
    });
    if (!ownerMembership) return { ok: false, error: "That team member could not be found." };
  }

  await prisma.contact.update({ where: { id: contactId }, data: { ownerUserId } });
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);
  revalidatePath("/dashboard/outreach/contacts");
  return { ok: true };
}

export async function setContactStatus(contactId: string, status: ContactStatusInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveContactInOrg(userId, contactId);
  if (!resolved) return { ok: false, error: "Contact not found." };

  await prisma.contact.update({ where: { id: contactId }, data: { status } });
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);
  revalidatePath("/dashboard/outreach/contacts");
  return { ok: true };
}

export async function bulkTagContacts(contactIds: string[], tags: string[]): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds }, organizationId: membership.organizationId } });
  await Promise.all(
    contacts.map((c) => {
      const merged = Array.from(new Set([...c.tags, ...tags]));
      return prisma.contact.update({ where: { id: c.id }, data: { tags: merged } });
    }),
  );

  revalidatePath("/dashboard/outreach/contacts");
  return { ok: true };
}

export interface CreateFromCompanyResult extends ActionResult {
  contactId?: string;
}

/** Thin helper — creates a Contact linked to an existing Company, keeping this additive to Lead Finder/Company Intelligence rather than a parallel discovery mechanism. */
export async function createContactFromCompany(
  companyId: string,
  input: { firstName: string; lastName?: string; email: string; jobTitle?: string },
): Promise<CreateFromCompanyResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.organizationId !== membership.organizationId) return { ok: false, error: "Company not found." };

  const parsed = contactSchema.safeParse({ ...input, companyId, country: company.headquartersCountry ?? "", city: company.headquartersCity ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the contact details." };

  try {
    // Phase 25 (dedup-bypass fix): routed through the real single choke
    // point instead of a direct prisma.contact.create().
    const { contact, wasCreated } = await findOrCreateContact({
      organizationId: membership.organizationId,
      companyId,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName || null,
      email: parsed.data.email,
      jobTitle: parsed.data.jobTitle || null,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
    });

    if (wasCreated) {
      await logAudit({ userId, organizationId: membership.organizationId, action: "outreach.contact_created_from_company", metadata: { contactId: contact.id, companyId } });
    }
    revalidatePath("/dashboard/outreach/contacts");
    revalidatePath(`/dashboard/companies/${companyId}`);
    return { ok: true, contactId: contact.id };
  } catch (error) {
    console.error("[outreach] createContactFromCompany failed:", error);
    return { ok: false, error: "Something went wrong creating the contact. Please try again." };
  }
}
