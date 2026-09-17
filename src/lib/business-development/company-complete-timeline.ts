import { prisma } from "@/lib/prisma";

/**
 * A single real, chronological fact about a Company's complete conversation
 * history — composed at READ TIME from each source table's own real
 * timestamps. Deliberately NOT written into CompanyTimelineEvent (see this
 * file's header doc for why): that model's CompanyTimelineEventType enum
 * (CREATED/FUNDING/WEBSITE_UPDATE/ANNOUNCEMENT/HIRING/EXPANSION/
 * RESEARCH_NOTE/INTERNAL_ACTIVITY) has no email/opportunity/decision-maker/
 * meeting/proposal/deal categories, and nothing writes those event kinds to
 * it today — extending it (or double-writing conversation events into it)
 * would create a second, competing event-log concept. This function instead
 * assembles one real array, every entry traceable to one real row in one
 * real table, sorted ascending by when it actually happened.
 */
export interface TimelineEntry {
  type: string;
  label: string;
  occurredAt: Date;
  recordId: string;
  recordType: string;
  /** A real route to that record's detail page, or null when none exists — never a fabricated link. */
  linkHref: string | null;
}

function contactDisplayName(contact: { firstName: string; lastName: string | null } | null | undefined): string {
  if (!contact) return "the contact";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "the contact";
}

/**
 * Composes the complete cross-source timeline for one real Company —
 * emails, replies, opportunities, decision-makers, meetings, proposals,
 * deals, the company's own discovery, and any website scan — into one
 * chronological array. Verifies the company belongs to `organizationId`
 * before querying anything else; returns an empty array (never throws to
 * the UI) if the company isn't found or doesn't belong to this org.
 */
export async function getCompanyCompleteTimeline(organizationId: string, companyId: string): Promise<TimelineEntry[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, organizationId: true, createdAt: true },
  });
  if (!company || company.organizationId !== organizationId) return [];

  const contacts = await prisma.contact.findMany({
    where: { companyId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  const contactIds = contacts.map((c) => c.id);
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const [emailDrafts, replies, opportunities, decisionMakers, meetings, proposals, deals, websiteScans] = await Promise.all([
    contactIds.length > 0
      ? prisma.emailDraft.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          select: {
            id: true,
            contactId: true,
            channel: true,
            subject: true,
            status: true,
            createdAt: true,
            sentAt: true,
            openCount: true,
            firstOpenedAt: true,
            clickCount: true,
            firstClickedAt: true,
          },
        })
      : [],
    contactIds.length > 0
      ? prisma.reply.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          select: { id: true, contactId: true, receivedAt: true, intent: true, sentiment: true },
        })
      : [],
    prisma.leadOpportunity.findMany({
      where: { companyId },
      select: { id: true, title: true, createdAt: true },
    }),
    prisma.decisionMaker.findMany({
      where: { companyId },
      select: { id: true, name: true, role: true, createdAt: true },
    }),
    contactIds.length > 0
      ? prisma.outreachMeeting.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          select: { id: true, contactId: true, title: true, createdAt: true },
        })
      : [],
    prisma.proposal.findMany({
      where: { companyId, organizationId },
      select: { id: true, title: true, createdAt: true },
    }),
    prisma.deal.findMany({
      where: { companyId, organizationId },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.websiteScan.findMany({
      where: { companyId, organizationId },
      select: { id: true, createdAt: true },
    }),
  ]);

  const entries: TimelineEntry[] = [];

  entries.push({
    type: "company_discovered",
    label: "Company discovered",
    occurredAt: company.createdAt,
    recordId: company.id,
    recordType: "Company",
    linkHref: null,
  });

  for (const scan of websiteScans) {
    entries.push({
      type: "website_scanned",
      label: "Website scanned",
      occurredAt: scan.createdAt,
      recordId: scan.id,
      recordType: "WebsiteScan",
      linkHref: `/dashboard/website-scanner/${scan.id}`,
    });
  }

  for (const draft of emailDrafts) {
    const contactName = contactDisplayName(contactById.get(draft.contactId));
    const subjectSuffix = draft.subject ? `: "${draft.subject}"` : "";
    const threadHref = `/dashboard/outreach/inbox/${draft.contactId}`;

    entries.push({
      type: "email_drafted",
      label: `Drafted a ${draft.channel.toLowerCase()} to ${contactName}${subjectSuffix}`,
      occurredAt: draft.createdAt,
      recordId: draft.id,
      recordType: "EmailDraft",
      linkHref: threadHref,
    });

    if (draft.sentAt) {
      entries.push({
        type: "email_sent",
        label: `Sent ${draft.channel.toLowerCase()} to ${contactName}${subjectSuffix}`,
        occurredAt: draft.sentAt,
        recordId: draft.id,
        recordType: "EmailDraft",
        linkHref: threadHref,
      });
    }

    if (draft.firstOpenedAt) {
      entries.push({
        type: "email_opened",
        label: `${contactName} opened the email (opened ${draft.openCount} time${draft.openCount === 1 ? "" : "s"}${
          draft.firstClickedAt ? `, ${draft.clickCount} click${draft.clickCount === 1 ? "" : "s"}` : ""
        })`,
        occurredAt: draft.firstOpenedAt,
        recordId: draft.id,
        recordType: "EmailDraft",
        linkHref: threadHref,
      });
    }
  }

  for (const reply of replies) {
    const contactName = contactDisplayName(contactById.get(reply.contactId));
    const threadHref = `/dashboard/outreach/inbox/${reply.contactId}`;

    entries.push({
      type: "reply_received",
      label: `${contactName} replied`,
      occurredAt: reply.receivedAt,
      recordId: reply.id,
      recordType: "Reply",
      linkHref: threadHref,
    });

    if (reply.intent || reply.sentiment) {
      const parts = [reply.intent, reply.sentiment].filter(Boolean).join(" / ");
      entries.push({
        type: "reply_classified",
        label: `AI classified reply as ${parts}`,
        occurredAt: reply.receivedAt,
        recordId: reply.id,
        recordType: "Reply",
        linkHref: threadHref,
      });
    }
  }

  for (const opportunity of opportunities) {
    entries.push({
      type: "opportunity_detected",
      label: `Opportunity detected: ${opportunity.title}`,
      occurredAt: opportunity.createdAt,
      recordId: opportunity.id,
      recordType: "LeadOpportunity",
      linkHref: `/dashboard/opportunities/${opportunity.id}`,
    });
  }

  for (const dm of decisionMakers) {
    entries.push({
      type: "decision_maker_identified",
      label: `Decision-maker identified: ${dm.name} (${dm.role.replaceAll("_", " ").toLowerCase()})`,
      occurredAt: dm.createdAt,
      recordId: dm.id,
      recordType: "DecisionMaker",
      // No standalone decision-maker detail page exists today — this
      // company page IS the real place this record is shown.
      linkHref: null,
    });
  }

  for (const meeting of meetings) {
    entries.push({
      type: "meeting_requested",
      label: `Meeting requested: ${meeting.title}`,
      occurredAt: meeting.createdAt,
      recordId: meeting.id,
      recordType: "OutreachMeeting",
      linkHref: `/dashboard/outreach/contacts/${meeting.contactId}`,
    });
  }

  for (const proposal of proposals) {
    entries.push({
      type: "proposal_generated",
      label: `Proposal generated: ${proposal.title}`,
      occurredAt: proposal.createdAt,
      recordId: proposal.id,
      recordType: "Proposal",
      linkHref: `/dashboard/proposal/proposals/${proposal.id}`,
    });
  }

  for (const deal of deals) {
    entries.push({
      type: "deal_created",
      label: `Deal created: ${deal.name}`,
      occurredAt: deal.createdAt,
      recordId: deal.id,
      recordType: "Deal",
      linkHref: `/dashboard/crm/deals/${deal.id}`,
    });
  }

  entries.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return entries;
}
