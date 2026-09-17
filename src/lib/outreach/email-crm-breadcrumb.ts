import { prisma } from "@/lib/prisma";
import type { Lead, LeadOpportunity, Deal, Campaign, Sequence, Proposal } from "@/generated/prisma/client";

/**
 * Email Center CRM breadcrumb — composes the real (not invented)
 * Contact -> Company -> Opportunity -> Deal -> Proposal chain for a single
 * contact, for display on the per-contact inbox thread page.
 *
 * Schema reality this respects (confirmed via direct schema read, not
 * assumed): there is NO foreign key from LeadOpportunity to Deal.
 * LeadOpportunity only has `companyId`; Deal independently has `companyId`,
 * `contactId`, and `sourceLeadId` (which links to the OTHER pipeline model,
 * `Lead`, not `LeadOpportunity`). So this breadcrumb is composed by querying
 * Company.leadOpportunities and Company.deals independently, both scoped by
 * the same companyId — it never invents a direct relation that doesn't
 * exist in the schema. `Company.leads` (the `Lead` model, distinct from
 * `LeadOpportunity`) is included too since `Deal.sourceLeadId` connects
 * there.
 *
 * Every array field can legitimately be empty — this function never
 * fabricates a placeholder "no opportunity yet" object; callers render that
 * honesty in the UI themselves.
 */
export interface EmailCrmBreadcrumb {
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string;
  };
  company: { id: string; name: string } | null;
  leads: Lead[];
  leadOpportunities: LeadOpportunity[];
  deals: Deal[];
  /** Most recent Campaign this contact is enrolled in (via CampaignContact), or null. */
  campaign: Campaign | null;
  /** Sequence behind the contact's most recent sequenced EmailDraft, or null — there is no direct Contact<->Sequence relation in the schema, so this is derived from EmailDraft.sequenceId. */
  sequence: Sequence | null;
  proposals: Proposal[];
}

/**
 * Org-ownership: verifies the contact belongs to `organizationId` first and
 * returns `null` (rather than throwing) when the contact doesn't exist or
 * belongs to a different organization — same honest "caller gets an empty
 * state, cross-org data is never returned" convention as
 * getContactTimeline in src/lib/outreach/inbox.ts.
 */
export async function getEmailCrmBreadcrumb(organizationId: string, contactId: string): Promise<EmailCrmBreadcrumb | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { company: { select: { id: true, name: true } } },
  });

  if (!contact || contact.organizationId !== organizationId) return null;

  const companyId = contact.companyId;

  const [leads, leadOpportunities, deals, latestCampaignContact, latestSequencedDraft] = await Promise.all([
    companyId ? prisma.lead.findMany({ where: { companyId } }) : Promise.resolve([]),
    companyId ? prisma.leadOpportunity.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    companyId ? prisma.deal.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    prisma.campaignContact.findFirst({
      where: { contactId },
      orderBy: { enrolledAt: "desc" },
      include: { campaign: true },
    }),
    prisma.emailDraft.findFirst({
      where: { contactId, sequenceId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { sequence: true },
    }),
  ]);

  // Proposals can be linked via companyId directly, or only via dealId (a
  // proposal generated for one of this company's own real Deal rows above,
  // scoped by that same real relation rather than a guessed one).
  const dealIds = deals.map((d) => d.id);
  const proposals = companyId
    ? await prisma.proposal.findMany({
        where: { OR: [{ companyId }, ...(dealIds.length > 0 ? [{ dealId: { in: dealIds } }] : [])] },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return {
    contact: {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
    },
    company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
    leads,
    leadOpportunities,
    deals,
    campaign: latestCampaignContact?.campaign ?? null,
    sequence: latestSequencedDraft?.sequence ?? null,
    proposals,
  };
}
