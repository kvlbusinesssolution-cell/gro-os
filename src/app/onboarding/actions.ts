"use server";

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateUniqueOrgSlug } from "@/lib/slug";
import { logAudit } from "@/lib/audit";
import { ensurePlansSeeded, getDefaultFreePlan } from "@/lib/billing/plan-catalog";
import type { Organization } from "@/generated/prisma/client";
import {
  companyProfileSchema,
  businessDetailsSchema,
  servicesGoalsSchema,
  type CompanyProfileInput,
  type BusinessDetailsInput,
  type ServicesGoalsInput,
} from "@/lib/validations/onboarding";

export interface OnboardingActionResult {
  ok: boolean;
  error?: string;
  organization?: Organization;
}

/**
 * Loads the Organization owned (role OWNER) by the current user, creating one
 * with a placeholder name if this is their first visit to the wizard. Safe
 * to call every time /onboarding is rendered — it's the single entry point
 * that both starts and resumes the wizard (an existing org is returned
 * as-is, complete with whatever prior steps were already auto-saved, so a
 * reload or return visit lands the user back where they left off).
 */
export async function createOrContinueOrganization(): Promise<OnboardingActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  const userId = session.user.id;

  const existingMembership = await prisma.membership.findFirst({
    where: { userId, role: "OWNER" },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingMembership) {
    return { ok: true, organization: existingMembership.organization };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const placeholderName = user?.firstName
    ? `${user.firstName}'s Organization`
    : user?.name
      ? `${user.name}'s Organization`
      : "My Organization";

  const slug = await generateUniqueOrgSlug(prisma, placeholderName);

  // Phase 18 reseller referral capture — consume the `growthos_ref` cookie
  // /register wrote (if any) exactly once, at real org-creation time. Only
  // ever set when it resolves to a real, existing Partner.referralCode —
  // never trusted/stored blindly.
  const cookieStore = await cookies();
  const refCode = cookieStore.get("growthos_ref")?.value;
  let referredByPartnerId: string | undefined;
  if (refCode) {
    const partner = await prisma.partner.findUnique({ where: { referralCode: refCode }, select: { id: true } });
    referredByPartnerId = partner?.id;
    cookieStore.delete("growthos_ref");
  }

  const organization = await prisma.organization.create({
    data: {
      name: placeholderName,
      slug,
      referredByPartnerId,
      memberships: {
        create: { userId, role: "OWNER", status: "ACTIVE" },
      },
    },
  });

  // Real default plan assignment — every new organization (this is a brand
  // new signup, never KVL's own org, which is created once by an operator
  // and flagged Organization.isOwnerOrg = true directly in the database)
  // starts on the real, limited FREE tier, not silently unlimited. Without
  // this, checkPlanLimit's own FREE-tier fallback (usage-metering.ts)
  // would still apply the same limits, but a real BillingAccount row here
  // means the org's billing/subscription pages have something concrete to
  // show and upgrade from day one.
  await ensurePlansSeeded();
  const freePlan = await getDefaultFreePlan(organization.currency ?? "USD");
  if (freePlan) {
    await prisma.billingAccount.create({
      data: { organizationId: organization.id, currentPlanId: freePlan.id },
    });
  }

  await logAudit({
    userId,
    organizationId: organization.id,
    action: "organization.created",
    metadata: { slug: organization.slug },
  });

  return { ok: true, organization };
}

/**
 * Confirms the signed-in user is a member of `orgId` before any write, and
 * returns the organization's current row (used to compute onboardingStep
 * monotonically). Returns null when there's no session or no membership —
 * callers treat both as "access denied" without distinguishing them to the
 * client.
 */
async function requireOwnedOrganization(orgId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    include: { organization: true },
  });
  if (!membership || membership.organization.id !== orgId) return null;
  return membership.organization;
}

export async function updateCompanyProfile(
  orgId: string,
  data: CompanyProfileInput,
): Promise<OnboardingActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const parsed = companyProfileSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the company profile fields." };
  }

  const organization = await requireOwnedOrganization(orgId, userId);
  if (!organization) return { ok: false, error: "You do not have access to this organization." };

  const { logo, website, email, linkedin, facebook, twitter, ...rest } = parsed.data;

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...rest,
      logo: logo || null,
      website: website || null,
      email: email || null,
      linkedin: linkedin || null,
      facebook: facebook || null,
      twitter: twitter || null,
      onboardingStep: Math.max(organization.onboardingStep, 1),
    },
  });

  await logAudit({ userId, organizationId: orgId, action: "onboarding.company_profile_updated" });

  return { ok: true, organization: updated };
}

export async function updateBusinessDetails(
  orgId: string,
  data: BusinessDetailsInput,
): Promise<OnboardingActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const parsed = businessDetailsSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the business details fields." };
  }

  const organization = await requireOwnedOrganization(orgId, userId);
  if (!organization) return { ok: false, error: "You do not have access to this organization." };

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...parsed.data,
      onboardingStep: Math.max(organization.onboardingStep, 2),
    },
  });

  await logAudit({ userId, organizationId: orgId, action: "onboarding.business_details_updated" });

  return { ok: true, organization: updated };
}

export async function updateServicesGoals(
  orgId: string,
  data: ServicesGoalsInput,
): Promise<OnboardingActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const userId = session.user.id;

  const parsed = servicesGoalsSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the services & goals fields." };
  }

  const organization = await requireOwnedOrganization(orgId, userId);
  if (!organization) return { ok: false, error: "You do not have access to this organization." };

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...parsed.data,
      onboardingStep: Math.max(organization.onboardingStep, 3),
    },
  });

  await logAudit({ userId, organizationId: orgId, action: "onboarding.services_goals_updated" });

  return { ok: true, organization: updated };
}
