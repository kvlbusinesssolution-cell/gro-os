"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { logActivity } from "@/lib/activity";
import { logAudit } from "@/lib/audit";
import { addCompanyTimelineEvent } from "@/lib/company-intelligence";
import { scoreCompany } from "@/lib/lead-scoring";
import { geocodeAddress } from "@/lib/geo/geocode";
import { companySchema, type CompanyInput } from "@/lib/validations/company-directory";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const EDITOR_ROLES = new Set(["OWNER", "ADMIN"]);

export interface ResolvedReferralPartnerId {
  ok: true;
  referralPartnerId: string | null;
}
export interface ResolvedReferralPartnerError {
  ok: false;
  error: string;
}

/**
 * Validates an optional `referralPartnerId` off the company form actually
 * belongs to this org before it's ever persisted onto Company — the
 * multi-tenant isolation boundary every prior phase enforces (never trust a
 * bare id without an org-ownership check).
 *
 * Deliberately does NOT also require `status === "ACTIVE"` here: the picker
 * in company-form.tsx/company-edit-form.tsx only *offers* ACTIVE partners
 * for a NEW attribution (a CANDIDATE, AI-discovered and not yet recruited,
 * shouldn't be newly attributable) — but re-enforcing that on every save
 * would break saving unrelated field edits on a company whose partner was
 * later deactivated, silently clearing a real, already-established
 * attribution. Org ownership is the actual security boundary; ACTIVE-only is
 * just curation of what's offered going forward.
 */
async function resolveReferralPartnerId(
  organizationId: string,
  referralPartnerId: string | undefined,
): Promise<ResolvedReferralPartnerId | ResolvedReferralPartnerError> {
  if (!referralPartnerId) return { ok: true, referralPartnerId: null };

  const partner = await prisma.referralPartner.findUnique({ where: { id: referralPartnerId } });
  if (!partner || partner.organizationId !== organizationId) {
    return { ok: false, error: "That referral partner could not be found." };
  }

  return { ok: true, referralPartnerId: partner.id };
}

/** Shared field mapping for both create and update — keeps the two in sync as the profile schema grows. */
function buildProfileData(parsed: z.output<typeof companySchema>) {
  const socialLinks =
    parsed.linkedinUrl || parsed.facebookUrl || parsed.twitterUrl || parsed.instagramUrl
      ? {
          linkedin: parsed.linkedinUrl || undefined,
          facebook: parsed.facebookUrl || undefined,
          twitter: parsed.twitterUrl || undefined,
          instagram: parsed.instagramUrl || undefined,
        }
      : undefined;

  return {
    name: parsed.name,
    industry: parsed.industry || null,
    website: parsed.website || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    address: parsed.address || null,
    employeeCount: parsed.employeeCount ?? null,
    notes: parsed.notes || null,
    status: parsed.status,
    logo: parsed.logo || null,
    description: parsed.description || null,
    headquartersCountry: parsed.headquartersCountry || null,
    headquartersState: parsed.headquartersState || null,
    headquartersCity: parsed.headquartersCity || null,
    estimatedRevenue: parsed.estimatedRevenue ?? null,
    foundedYear: parsed.foundedYear ?? null,
    technologies: parsed.technologies ?? [],
    products: parsed.products ?? [],
    servicesOffered: parsed.servicesOffered ?? [],
    targetCustomers: parsed.targetCustomers || null,
    socialLinks: socialLinks ?? Prisma.JsonNull,
    googleMapsUrl: parsed.googleMapsUrl || null,
    contactFormUrl: parsed.contactFormUrl || null,
    businessType: parsed.businessType || null,
    remoteHybrid: parsed.remoteHybrid || null,
    publicPrivate: parsed.publicPrivate || null,
    growthRate: parsed.growthRate ?? null,
    fundingStage: parsed.fundingStage || null,
    fundingAmount: parsed.fundingAmount ?? null,
    language: parsed.language || null,
  };
}

export interface CreateCompanyResult extends ActionResult {
  companyId?: string;
}

/** Creates a real Company row — available to any ACTIVE member, same as Quick Actions' createLead. */
export async function createCompany(input: CompanyInput): Promise<CreateCompanyResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the company details." };
  }

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const organizationId = membership.organizationId;

  const resolvedPartner = await resolveReferralPartnerId(organizationId, parsed.data.referralPartnerId);
  if (!resolvedPartner.ok) return { ok: false, error: resolvedPartner.error };

  let coords: { lat: number; lng: number } | null = null;
  const hqQuery = [parsed.data.headquartersCity, parsed.data.headquartersState, parsed.data.headquartersCountry]
    .filter(Boolean)
    .join(", ");
  if (hqQuery) coords = await geocodeAddress(hqQuery);

  try {
    const company = await prisma.company.create({
      data: {
        ...buildProfileData(parsed.data),
        organizationId,
        // This form never exposes a `source` field of its own — createCompany
        // has always hardcoded "MANUAL" below. Picking a referral partner is
        // the only source signal this submission can carry, so it's safe to
        // let it choose "REFERRAL" here without silently overriding any
        // explicit user choice elsewhere in the same form.
        source: resolvedPartner.referralPartnerId ? "REFERRAL" : "MANUAL",
        referralPartnerId: resolvedPartner.referralPartnerId,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
      },
    });

    await logActivity({
      organizationId,
      type: "SYSTEM_EVENT",
      description: `${session.user?.name ?? "A team member"} added ${company.name} to Companies.`,
      actorUserId: userId,
      metadata: { companyId: company.id },
    });
    await logAudit({
      userId,
      organizationId,
      action: "companies.company_created",
      metadata: { companyId: company.id },
    });
    await addCompanyTimelineEvent({
      companyId: company.id,
      type: "CREATED",
      title: `${company.name} added to Companies`,
      source: "MANUAL",
    });
    await scoreCompany(company.id);

    revalidatePath("/dashboard/companies");
    revalidatePath("/dashboard/crm");
    return { ok: true, companyId: company.id };
  } catch (error) {
    console.error("[companies] createCompany failed:", error);
    return { ok: false, error: "Something went wrong creating the company. Please try again." };
  }
}

export async function updateCompany(companyId: string, input: CompanyInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the company details." };
  }

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  // Phase 24 (requirement #12, RBAC): the same OWNER/ADMIN bar deleteCompany
  // already enforces below — its own comment ("same bar as editing the org
  // profile") already implied this should apply here too, but no check
  // actually existed until now.
  if (!EDITOR_ROLES.has(membership.role)) {
    return { ok: false, error: "Only owners and admins can edit companies." };
  }

  try {
    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing || existing.organizationId !== membership.organizationId) {
      return { ok: false, error: "Company not found." };
    }

    const resolvedPartner = await resolveReferralPartnerId(membership.organizationId, parsed.data.referralPartnerId);
    if (!resolvedPartner.ok) return { ok: false, error: resolvedPartner.error };

    let coords: { lat: number; lng: number } | null = null;
    if (existing.latitude == null || existing.longitude == null) {
      const hqQuery = [parsed.data.headquartersCity, parsed.data.headquartersState, parsed.data.headquartersCountry]
        .filter(Boolean)
        .join(", ");
      if (hqQuery) coords = await geocodeAddress(hqQuery);
    }

    const nextTechnologies = parsed.data.technologies ?? [];
    const technologiesChanged =
      nextTechnologies.length !== existing.technologies.length ||
      nextTechnologies.some((t) => !existing.technologies.includes(t));

    await prisma.company.update({
      where: { id: companyId },
      data: {
        ...buildProfileData(parsed.data),
        referralPartnerId: resolvedPartner.referralPartnerId,
        ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
      },
    });

    // Phase 26 (requirement #6/#7, source priority + conflict handling): a
    // human editing this field manually is real MANUAL-source evidence —
    // without it, an automated WEBSITE_SCAN resync had no higher-priority
    // evidence to check against and would silently overwrite a real human
    // correction (see technology-evidence-sync.ts's resolveFieldConflict
    // call). Only written when the value genuinely changed.
    if (technologiesChanged && nextTechnologies.length > 0) {
      await prisma.companyEvidence.create({
        data: {
          companyId,
          kind: "RAW_FACT",
          fact: `Technologies manually set to: ${nextTechnologies.join(", ")}.`,
          source: "MANUAL",
          confidence: 1.0,
          fieldName: "technologies",
          verificationStatus: "USER_VERIFIED",
        },
      });
    }

    await logAudit({
      userId,
      organizationId: membership.organizationId,
      action: "companies.company_updated",
      metadata: { companyId },
    });

    revalidatePath("/dashboard/companies");
    revalidatePath(`/dashboard/companies/${companyId}`);
    revalidatePath("/dashboard/crm");
    return { ok: true };
  } catch (error) {
    console.error("[companies] updateCompany failed:", error);
    return { ok: false, error: "Something went wrong updating the company. Please try again." };
  }
}

/** Deletion is restricted to OWNER/ADMIN — same bar as editing the org profile. */
export async function deleteCompany(companyId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!EDITOR_ROLES.has(membership.role)) {
    return { ok: false, error: "Only owners and admins can delete companies." };
  }

  try {
    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing || existing.organizationId !== membership.organizationId) {
      return { ok: false, error: "Company not found." };
    }

    await prisma.company.delete({ where: { id: companyId } });
    await logAudit({
      userId,
      organizationId: membership.organizationId,
      action: "companies.company_deleted",
      metadata: { companyId },
    });

    revalidatePath("/dashboard/companies");
    revalidatePath("/dashboard/crm");
    return { ok: true };
  } catch (error) {
    console.error("[companies] deleteCompany failed:", error);
    return { ok: false, error: "Something went wrong deleting the company. Please try again." };
  }
}

async function resolveCompanyInOrg(userId: string, companyId: string) {
  const membership = await resolveActiveMembership(userId);
  if (!membership) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.organizationId !== membership.organizationId) return null;
  return { membership, company };
}

export interface AddToCrmResult extends ActionResult {
  leadId?: string;
  alreadyInCrm?: boolean;
}

/** One-click "Add to CRM" — creates a real Lead in the org's first pipeline stage, unless one already exists for this company. */
export async function addCompanyToCrm(companyId: string): Promise<AddToCrmResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveCompanyInOrg(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  const existingLead = await prisma.lead.findFirst({ where: { companyId } });
  if (existingLead) return { ok: true, leadId: existingLead.id, alreadyInCrm: true };

  const stage = await prisma.pipelineStage.findFirst({
    where: { workspace: { organizationId: resolved.membership.organizationId } },
    orderBy: { order: "asc" },
  });
  if (!stage) return { ok: false, error: "No pipeline stage is configured for your organization yet." };

  try {
    const lead = await prisma.lead.create({
      data: {
        pipelineStageId: stage.id,
        companyId,
        name: resolved.company.name,
        company: resolved.company.name,
        email: resolved.company.email,
        estimatedValue: resolved.company.estimatedRevenue,
      },
    });
    if (resolved.company.status === "PROSPECT") {
      await prisma.company.update({ where: { id: companyId }, data: { status: "LEAD" } });
    }
    await addCompanyTimelineEvent({
      companyId,
      type: "INTERNAL_ACTIVITY",
      title: `${resolved.company.name} added to CRM pipeline`,
      source: "MANUAL",
    });
    await logAudit({
      userId,
      organizationId: resolved.membership.organizationId,
      action: "companies.added_to_crm",
      metadata: { companyId, leadId: lead.id },
    });
    revalidatePath("/dashboard/crm");
    revalidatePath(`/dashboard/companies/${companyId}`);
    revalidatePath("/dashboard/companies");
    return { ok: true, leadId: lead.id };
  } catch (error) {
    console.error("[companies] addCompanyToCrm failed:", error);
    return { ok: false, error: "Something went wrong adding this company to the CRM. Please try again." };
  }
}

/** One-click "Assign Owner" — sets Company.ownerUserId to any active member of the org, or clears it. */
export async function assignCompanyOwner(companyId: string, ownerUserId: string | null): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveCompanyInOrg(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  if (ownerUserId) {
    const ownerMembership = await prisma.membership.findFirst({
      where: { userId: ownerUserId, organizationId: resolved.membership.organizationId, status: "ACTIVE" },
    });
    if (!ownerMembership) return { ok: false, error: "That team member could not be found." };
  }

  await prisma.company.update({ where: { id: companyId }, data: { ownerUserId } });
  await logAudit({
    userId,
    organizationId: resolved.membership.organizationId,
    action: "companies.owner_assigned",
    metadata: { companyId, ownerUserId },
  });
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

/** One-click "Mark Priority" — sets Company.priority (reuses the existing MessagePriority enum). */
export async function markCompanyPriority(companyId: string, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveCompanyInOrg(userId, companyId);
  if (!resolved) return { ok: false, error: "Company not found." };

  await prisma.company.update({ where: { id: companyId }, data: { priority } });
  await logAudit({
    userId,
    organizationId: resolved.membership.organizationId,
    action: "companies.priority_marked",
    metadata: { companyId, priority },
  });
  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath("/dashboard/companies");
  return { ok: true };
}
