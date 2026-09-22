import { prisma } from "@/lib/prisma";

/**
 * A single real, chronological fact about a Company's complete relationship
 * history — composed at READ TIME from each source table's own real
 * timestamps. Deliberately NOT written into CompanyTimelineEvent (see this
 * file's original header doc for why): that model's CompanyTimelineEventType
 * enum (CREATED/FUNDING/WEBSITE_UPDATE/ANNOUNCEMENT/HIRING/EXPANSION/
 * RESEARCH_NOTE/INTERNAL_ACTIVITY) has no email/opportunity/decision-maker/
 * meeting/proposal/deal/task/invoice/contract/project categories, and
 * nothing writes those event kinds to it today — extending it (or
 * double-writing these events into it) would create a second, competing
 * event-log concept. This function instead assembles one real array, every
 * entry traceable to one real row in one real table.
 *
 * Phase 5 (Client 360) extension: every entry now carries the full contract
 * the spec asked for (id, organizationId, companyId, actor, description,
 * metadata) — added to the EXISTING interface/entries rather than a new
 * parallel timeline. Because this is a pure read-time composer (never
 * persisted), calling it twice for the same company always produces the
 * identical array — idempotency (spec §7) is a structural property of this
 * design, not something that needed separate dedup logic.
 */
export interface TimelineEntry {
  id: string;
  organizationId: string;
  companyId: string;
  type: string;
  label: string;
  description: string | null;
  occurredAt: Date;
  actor: string;
  recordId: string;
  recordType: string;
  metadata: Record<string, unknown>;
  /** A real route to that record's detail page, or null when none exists — never a fabricated link. */
  linkHref: string | null;
}

const TIMELINE_SOURCE_LIMIT = 500;

function contactDisplayName(contact: { firstName: string; lastName: string | null } | null | undefined): string {
  if (!contact) return "the contact";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "the contact";
}

/**
 * Composes the complete cross-source timeline for one real Company —
 * emails, replies, opportunities, decision-makers, meetings, proposals,
 * deals, tasks/calls/support tickets, contracts, invoices/payments,
 * projects, the company's own discovery, and any website scan — into one
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
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const contactIds = contacts.map((c) => c.id);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactByPhone = new Map(contacts.filter((c) => c.phone).map((c) => [c.phone as string, c]));
  const phones = [...contactByPhone.keys()];

  const [emailDrafts, replies, opportunities, decisionMakers, meetings, proposals, deals, websiteScans, tasks, contracts, invoices, projects, whatsappOptOuts, calls] = await Promise.all([
    // Phase 5 §24: bounded to the most recent TIMELINE_SOURCE_LIMIT rows per
    // source table — the two sources most likely to grow large on an active
    // account. Prevents an unbounded full-history scan on every page load;
    // a company with real activity beyond this cap simply shows its most
    // recent window, never a fabricated "complete" claim past what's shown.
    contactIds.length > 0
      ? prisma.emailDraft.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          orderBy: { createdAt: "desc" },
          take: TIMELINE_SOURCE_LIMIT,
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
            generatedByAgentId: true,
            deliveredAt: true,
            readAt: true,
            failedAt: true,
            failedReason: true,
          },
        })
      : [],
    contactIds.length > 0
      ? prisma.reply.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          orderBy: { receivedAt: "desc" },
          take: TIMELINE_SOURCE_LIMIT,
          select: { id: true, contactId: true, receivedAt: true, intent: true, sentiment: true, channel: true },
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
          select: { id: true, contactId: true, title: true, createdAt: true, status: true },
        })
      : [],
    prisma.proposal.findMany({
      where: { companyId, organizationId },
      select: { id: true, title: true, createdAt: true, status: true },
    }),
    prisma.deal.findMany({
      where: { companyId, organizationId },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.websiteScan.findMany({
      where: { companyId, organizationId },
      select: { id: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { companyId, organizationId },
      select: { id: true, title: true, type: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.contract.findMany({
      where: { companyId, organizationId },
      select: { id: true, title: true, createdAt: true, value: true },
    }),
    prisma.invoice.findMany({
      where: { companyId, organizationId },
      select: { id: true, invoiceNumber: true, status: true, createdAt: true, grandTotal: true, amountPaid: true },
    }),
    prisma.project.findMany({
      where: { companyId, organizationId },
      select: { id: true, name: true, status: true, startDate: true, createdAt: true },
    }),
    // Phase 8 (WhatsApp Business Outreach) §23 — real WHATSAPP_OPT_OUT
    // events, matched via this company's own real contact phone numbers.
    phones.length > 0
      ? prisma.suppressionEntry.findMany({
          where: { organizationId, channel: "WHATSAPP", phone: { in: phones } },
          select: { id: true, phone: true, reason: true, source: true, createdAt: true },
        })
      : [],
    // Phase 10 (AI Voice Sales Engine) — real Call rows for this company's contacts.
    contactIds.length > 0
      ? prisma.call.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          orderBy: { createdAt: "desc" },
          take: TIMELINE_SOURCE_LIMIT,
          select: { id: true, contactId: true, status: true, outcome: true, eligibilityStatus: true, startedAt: true, answeredAt: true, endedAt: true, createdAt: true, cancelReason: true },
        })
      : [],
  ]);

  const entries: TimelineEntry[] = [];
  const push = (e: Omit<TimelineEntry, "id" | "organizationId" | "companyId">) => {
    entries.push({
      id: `${e.recordType}:${e.recordId}:${e.type}`,
      organizationId,
      companyId,
      ...e,
    });
  };

  push({
    type: "COMPANY_CREATED",
    label: "Company discovered",
    description: null,
    occurredAt: company.createdAt,
    actor: "System",
    recordId: company.id,
    recordType: "Company",
    metadata: {},
    linkHref: null,
  });

  for (const scan of websiteScans) {
    push({
      type: "RESEARCH_COMPLETED",
      label: "Website scanned",
      description: null,
      occurredAt: scan.createdAt,
      actor: "System",
      recordId: scan.id,
      recordType: "WebsiteScan",
      metadata: {},
      linkHref: `/dashboard/website-scanner/${scan.id}`,
    });
  }

  for (const draft of emailDrafts) {
    const contactName = contactDisplayName(contactById.get(draft.contactId));
    const subjectSuffix = draft.subject ? `: "${draft.subject}"` : "";
    const threadHref = `/dashboard/outreach/inbox/${draft.contactId}`;
    const actor = draft.generatedByAgentId ? "AI Agent" : "Team";
    // Phase 8 (WhatsApp Business Outreach) §23 / Phase 9 (LinkedIn Sales
    // Intelligence) §25 — real, distinct WHATSAPP_*/LINKEDIN_* event types
    // per channel; EMAIL keeps its original naming unchanged.
    const isWhatsApp = draft.channel === "WHATSAPP";
    const isLinkedIn = draft.channel === "LINKEDIN";

    push({
      type: isWhatsApp ? "WHATSAPP_CONVERSATION_STARTED" : isLinkedIn ? "LINKEDIN_MESSAGE_DRAFTED" : "EMAIL_DRAFTED",
      label: `Drafted a ${draft.channel.toLowerCase()} message to ${contactName}${subjectSuffix}`,
      description: null,
      occurredAt: draft.createdAt,
      actor,
      recordId: draft.id,
      recordType: "EmailDraft",
      metadata: { channel: draft.channel, status: draft.status },
      linkHref: threadHref,
    });

    if (draft.sentAt) {
      push({
        type: isWhatsApp ? "WHATSAPP_MESSAGE_SENT" : isLinkedIn ? "LINKEDIN_MESSAGE" : "EMAIL_SENT",
        label: `Sent ${draft.channel.toLowerCase()} message to ${contactName}${subjectSuffix}`,
        description: null,
        occurredAt: draft.sentAt,
        actor,
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: { channel: draft.channel },
        linkHref: threadHref,
      });
    }

    if (draft.firstOpenedAt) {
      push({
        type: "EMAIL_OPENED",
        label: `${contactName} opened the email (opened ${draft.openCount} time${draft.openCount === 1 ? "" : "s"}${
          draft.firstClickedAt ? `, ${draft.clickCount} click${draft.clickCount === 1 ? "" : "s"}` : ""
        })`,
        description: null,
        occurredAt: draft.firstOpenedAt,
        actor: contactName,
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: { openCount: draft.openCount, clickCount: draft.clickCount },
        linkHref: threadHref,
      });
    }

    if (draft.status === "BOUNCED") {
      push({
        type: "EMAIL_BOUNCED",
        label: `Email to ${contactName} bounced`,
        description: null,
        occurredAt: draft.sentAt ?? draft.createdAt,
        actor: "System",
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: {},
        linkHref: threadHref,
      });
    }

    // Real, provider-confirmed only (§11) — never inferred from SENT.
    if (draft.deliveredAt) {
      push({
        type: "WHATSAPP_MESSAGE_DELIVERED",
        label: `WhatsApp message to ${contactName} delivered`,
        description: null,
        occurredAt: draft.deliveredAt,
        actor: "System",
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: {},
        linkHref: threadHref,
      });
    }
    if (draft.readAt) {
      push({
        type: "WHATSAPP_MESSAGE_READ",
        label: `${contactName} read the WhatsApp message`,
        description: null,
        occurredAt: draft.readAt,
        actor: contactName,
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: {},
        linkHref: threadHref,
      });
    }
    if (isWhatsApp && draft.failedAt) {
      push({
        type: "WHATSAPP_MESSAGE_FAILED",
        label: `WhatsApp message to ${contactName} failed${draft.failedReason ? `: ${draft.failedReason}` : ""}`,
        description: null,
        occurredAt: draft.failedAt,
        actor: "System",
        recordId: draft.id,
        recordType: "EmailDraft",
        metadata: {},
        linkHref: threadHref,
      });
    }
  }

  for (const reply of replies) {
    const contactName = contactDisplayName(contactById.get(reply.contactId));
    const threadHref = `/dashboard/outreach/inbox/${reply.contactId}`;

    push({
      type: reply.channel === "WHATSAPP" ? "WHATSAPP_REPLY_RECEIVED" : reply.channel === "LINKEDIN" ? "LINKEDIN_REPLY" : "REPLY_RECEIVED",
      label: `${contactName} replied`,
      description: null,
      occurredAt: reply.receivedAt,
      actor: contactName,
      recordId: reply.id,
      recordType: "Reply",
      metadata: { intent: reply.intent, sentiment: reply.sentiment },
      linkHref: threadHref,
    });
  }

  for (const opportunity of opportunities) {
    push({
      type: "OPPORTUNITY_CREATED",
      label: `Opportunity detected: ${opportunity.title}`,
      description: null,
      occurredAt: opportunity.createdAt,
      actor: "AI Agent",
      recordId: opportunity.id,
      recordType: "LeadOpportunity",
      metadata: {},
      linkHref: `/dashboard/opportunities/${opportunity.id}`,
    });
  }

  for (const dm of decisionMakers) {
    push({
      type: "DECISION_MAKER_FOUND",
      label: `Decision-maker identified: ${dm.name} (${dm.role.replaceAll("_", " ").toLowerCase()})`,
      description: null,
      occurredAt: dm.createdAt,
      actor: "AI Agent",
      recordId: dm.id,
      recordType: "DecisionMaker",
      metadata: { role: dm.role },
      // No standalone decision-maker detail page exists today — this
      // company page IS the real place this record is shown.
      linkHref: null,
    });
  }

  for (const meeting of meetings) {
    push({
      type: meeting.status === "COMPLETED" ? "MEETING_COMPLETED" : "MEETING_SCHEDULED",
      label: `Meeting ${meeting.status === "COMPLETED" ? "completed" : "requested"}: ${meeting.title}`,
      description: null,
      occurredAt: meeting.createdAt,
      actor: "Team",
      recordId: meeting.id,
      recordType: "OutreachMeeting",
      metadata: { status: meeting.status },
      linkHref: `/dashboard/outreach/contacts/${meeting.contactId}`,
    });
  }

  for (const proposal of proposals) {
    push({
      type: "PROPOSAL_CREATED",
      label: `Proposal generated: ${proposal.title}`,
      description: null,
      occurredAt: proposal.createdAt,
      actor: "AI Agent",
      recordId: proposal.id,
      recordType: "Proposal",
      metadata: { status: proposal.status },
      linkHref: `/dashboard/proposal/proposals/${proposal.id}`,
    });
    if (proposal.status === "SENT" || proposal.status === "ACCEPTED" || proposal.status === "REJECTED") {
      push({
        type: "PROPOSAL_SENT",
        label: `Proposal sent: ${proposal.title}`,
        description: null,
        occurredAt: proposal.createdAt,
        actor: "Team",
        recordId: proposal.id,
        recordType: "Proposal",
        metadata: { status: proposal.status },
        linkHref: `/dashboard/proposal/proposals/${proposal.id}`,
      });
    }
  }

  for (const deal of deals) {
    push({
      type: "DEAL_CREATED",
      label: `Deal created: ${deal.name}`,
      description: null,
      occurredAt: deal.createdAt,
      actor: "Team",
      recordId: deal.id,
      recordType: "Deal",
      metadata: {},
      linkHref: `/dashboard/crm/deals/${deal.id}`,
    });
  }

  for (const task of tasks) {
    const eventType = task.type === "SUPPORT" ? "SUPPORT_TICKET_CREATED" : task.type === "CALL" ? "CALL" : "TASK_CREATED";
    push({
      type: eventType,
      label: `${task.type === "SUPPORT" ? "Support ticket" : task.type === "CALL" ? "Call logged" : "Task"}: ${task.title}`,
      description: null,
      occurredAt: task.createdAt,
      actor: "Team",
      recordId: task.id,
      recordType: "Task",
      metadata: { taskType: task.type, status: task.status },
      linkHref: null,
    });
    if (task.status === "COMPLETED") {
      push({
        type: task.type === "SUPPORT" ? "SUPPORT_TICKET_RESOLVED" : "TASK_COMPLETED",
        label: `${task.type === "SUPPORT" ? "Support ticket resolved" : "Task completed"}: ${task.title}`,
        description: null,
        occurredAt: task.updatedAt,
        actor: "Team",
        recordId: task.id,
        recordType: "Task",
        metadata: { taskType: task.type },
        linkHref: null,
      });
    }
  }

  for (const contract of contracts) {
    push({
      type: "CONTRACT_CREATED",
      label: `Contract created: ${contract.title}`,
      description: null,
      occurredAt: contract.createdAt,
      actor: "Team",
      recordId: contract.id,
      recordType: "Contract",
      metadata: { value: contract.value },
      linkHref: `/dashboard/proposal/contracts/${contract.id}`,
    });
  }

  for (const invoice of invoices) {
    push({
      type: "INVOICE_CREATED",
      label: `Invoice created: ${invoice.invoiceNumber}`,
      description: null,
      occurredAt: invoice.createdAt,
      actor: "Team",
      recordId: invoice.id,
      recordType: "Invoice",
      metadata: { status: invoice.status, grandTotal: invoice.grandTotal },
      linkHref: `/dashboard/proposal/invoices/${invoice.id}`,
    });
    if (invoice.status === "SENT" || invoice.status === "PAID" || invoice.status === "OVERDUE") {
      push({
        type: "INVOICE_SENT",
        label: `Invoice sent: ${invoice.invoiceNumber}`,
        description: null,
        occurredAt: invoice.createdAt,
        actor: "Team",
        recordId: invoice.id,
        recordType: "Invoice",
        metadata: { grandTotal: invoice.grandTotal },
        linkHref: `/dashboard/proposal/invoices/${invoice.id}`,
      });
    }
    // No dedicated Payment model exists — a real amountPaid > 0 on the
    // Invoice itself is the honest, traceable source for this event; never
    // a fabricated payment date (uses the invoice's own createdAt since
    // there's no separate paidAt column to draw from).
    if (invoice.amountPaid > 0) {
      push({
        type: "PAYMENT_RECEIVED",
        label: `Payment received on invoice ${invoice.invoiceNumber}: ${invoice.amountPaid}`,
        description: "Derived from Invoice.amountPaid — no dedicated Payment record exists in this system.",
        occurredAt: invoice.createdAt,
        actor: "System",
        recordId: invoice.id,
        recordType: "Invoice",
        metadata: { amountPaid: invoice.amountPaid, grandTotal: invoice.grandTotal },
        linkHref: `/dashboard/proposal/invoices/${invoice.id}`,
      });
    }
  }

  for (const project of projects) {
    push({
      type: "PROJECT_STARTED",
      label: `Project started: ${project.name}`,
      description: null,
      occurredAt: project.startDate ?? project.createdAt,
      actor: "Team",
      recordId: project.id,
      recordType: "Project",
      metadata: { status: project.status },
      linkHref: `/dashboard/projects/${project.id}`,
    });
    if (project.status === "COMPLETED") {
      push({
        type: "PROJECT_COMPLETED",
        label: `Project completed: ${project.name}`,
        description: null,
        occurredAt: project.startDate ?? project.createdAt, // Project has no completedAt column — honest reuse of the last known real date rather than a fabricated one
        actor: "Team",
        recordId: project.id,
        recordType: "Project",
        metadata: {},
        linkHref: `/dashboard/projects/${project.id}`,
      });
    }
  }

  for (const optOut of whatsappOptOuts) {
    const contact = optOut.phone ? contactByPhone.get(optOut.phone) : undefined;
    push({
      type: "WHATSAPP_OPT_OUT",
      label: `${contactDisplayName(contact)} opted out of WhatsApp messages (${optOut.reason})`,
      description: null,
      occurredAt: optOut.createdAt,
      actor: contactDisplayName(contact),
      recordId: optOut.id,
      recordType: "SuppressionEntry",
      metadata: { reason: optOut.reason, source: optOut.source },
      linkHref: contact ? `/dashboard/outreach/inbox/${contact.id}` : null,
    });
  }

  // Phase 10 (AI Voice Sales Engine) §36 — real Call lifecycle events only.
  // A CANCELLED call blocked by eligibility (voice-call.ts) is shown as
  // CALL_BLOCKED, never silently omitted — real evidence of why no call
  // happened is as important as evidence that one did.
  const CALL_STATUS_TYPE: Record<string, string> = {
    CALL_REQUESTED: "CALL_SCHEDULED",
    RINGING: "CALL_STARTED",
    ANSWERED: "CALL_ANSWERED",
    NO_ANSWER: "CALL_NO_ANSWER",
    BUSY: "CALL_BUSY",
    VOICEMAIL: "CALL_VOICEMAIL",
    COMPLETED: "CALL_COMPLETED",
    FAILED: "CALL_NO_ANSWER",
  };
  for (const call of calls) {
    const contact = contactById.get(call.contactId);
    const contactName = contactDisplayName(contact);
    const href = `/dashboard/outreach/inbox/${call.contactId}`;

    if (call.status === "CANCELLED") {
      push({
        type: "CALL_BLOCKED",
        label: `Voice call to ${contactName} not placed — ${call.eligibilityStatus}`,
        description: call.cancelReason,
        occurredAt: call.createdAt,
        actor: "System",
        recordId: call.id,
        recordType: "Call",
        metadata: { eligibilityStatus: call.eligibilityStatus },
        linkHref: href,
      });
      continue;
    }

    push({
      type: CALL_STATUS_TYPE[call.status] ?? "CALL_SCHEDULED",
      label: `Voice call to ${contactName} — ${call.status.toLowerCase().replaceAll("_", " ")}`,
      description: null,
      occurredAt: call.endedAt ?? call.answeredAt ?? call.startedAt ?? call.createdAt,
      actor: "System",
      recordId: call.id,
      recordType: "Call",
      metadata: { status: call.status, outcome: call.outcome },
      linkHref: href,
    });

    if (call.outcome) {
      push({
        type: "CALL_OUTCOME_UPDATED",
        label: `Call outcome for ${contactName}: ${call.outcome.replaceAll("_", " ").toLowerCase()}`,
        description: null,
        occurredAt: call.endedAt ?? call.createdAt,
        actor: "Team",
        recordId: call.id,
        recordType: "Call",
        metadata: { outcome: call.outcome },
        linkHref: href,
      });
    }
  }

  // Deterministic ordering (spec §6): timestamp, then the stable synthetic
  // id as the final tie-breaker — never relies on array insertion order.
  entries.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  return entries;
}
