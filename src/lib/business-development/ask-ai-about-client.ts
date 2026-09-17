import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";

export interface AskAiAboutClientResult {
  answer: string;
  groundedIn: string[];
}

const AskAiSchema = z.object({
  answer: z.string(),
  groundedIn: z.array(z.string()),
});

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function contactLabel(contact: { firstName: string; lastName: string | null } | null | undefined): string {
  if (!contact) return "Unknown contact";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown contact";
}

/**
 * Assembles a single real, company/contact-scoped context string — same
 * "labeled `## Heading` sections, every line a real fact or omitted
 * entirely" assembly style as src/lib/context-engine.ts's buildAgentContext,
 * but scoped to exactly one Company rather than the whole organization.
 * Every real record cited is prefixed with its own `RecordType:id` tag so
 * the downstream AI call can honestly report which real rows an answer
 * actually drew from (see askAiAboutClient's `groundedIn`).
 */
async function buildClientContext(organizationId: string, companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      industry: true,
      status: true,
      description: true,
    },
  });
  if (!company || company.organizationId !== organizationId) return null;

  const contacts = await prisma.contact.findMany({
    where: { companyId, organizationId },
    select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true },
  });
  const contactIds = contacts.map((c) => c.id);
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const [sentDrafts, replies, meetings, tasks, opportunities, proposals, deals, evidence] = await Promise.all([
    contactIds.length > 0
      ? prisma.emailDraft.findMany({
          where: { contactId: { in: contactIds }, organizationId, sentAt: { not: null } },
          orderBy: { sentAt: "asc" },
          select: { id: true, contactId: true, subject: true, body: true, sentAt: true },
        })
      : [],
    contactIds.length > 0
      ? prisma.reply.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          orderBy: { receivedAt: "asc" },
          select: { id: true, contactId: true, content: true, receivedAt: true, intent: true, sentiment: true },
        })
      : [],
    contactIds.length > 0
      ? prisma.outreachMeeting.findMany({
          where: { contactId: { in: contactIds }, organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true, title: true, status: true, scheduledAt: true, agenda: true, createdAt: true },
        })
      : [],
    prisma.task.findMany({
      where: { companyId, organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, description: true, status: true, dueDate: true, createdAt: true },
    }),
    prisma.leadOpportunity.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, description: true, estimatedValue: true, status: true, priority: true, createdAt: true },
    }),
    prisma.proposal.findMany({
      where: { companyId, organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, status: true, value: true, sentAt: true, acceptedAt: true, rejectedAt: true, createdAt: true },
    }),
    prisma.deal.findMany({
      where: { companyId, organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, value: true, probability: true, expectedCloseDate: true, notes: true, createdAt: true },
    }),
    prisma.companyEvidence.findMany({
      where: { companyId },
      orderBy: { discoveredAt: "asc" },
      take: 50,
      select: { id: true, kind: true, fact: true, confidence: true, discoveredAt: true },
    }),
  ]);

  const sections: string[] = [];

  sections.push(
    [
      "## Company",
      `- [Company:${company.id}] ${company.name}${company.industry ? ` (${company.industry})` : ""} — status: ${company.status}`,
      company.description ? `  Description: ${company.description}` : null,
    ]
      .filter((l): l is string => l !== null)
      .join("\n"),
  );

  if (contacts.length > 0) {
    const lines = ["## Contacts"];
    for (const c of contacts) {
      lines.push(`- [Contact:${c.id}] ${contactLabel(c)}${c.jobTitle ? `, ${c.jobTitle}` : ""} <${c.email}>`);
    }
    sections.push(lines.join("\n"));
  }

  if (sentDrafts.length > 0) {
    const lines = ["## Emails sent"];
    for (const d of sentDrafts) {
      lines.push(
        `- [EmailDraft:${d.id}] ${formatDate(d.sentAt!)} to ${contactLabel(contactById.get(d.contactId))}${
          d.subject ? ` — Subject: ${d.subject}` : ""
        }\n  Body: ${d.body}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (replies.length > 0) {
    const lines = ["## Replies received"];
    for (const r of replies) {
      lines.push(
        `- [Reply:${r.id}] ${formatDate(r.receivedAt)} from ${contactLabel(contactById.get(r.contactId))}${
          r.intent ? ` (intent: ${r.intent})` : ""
        }${r.sentiment ? ` (sentiment: ${r.sentiment})` : ""}\n  Content: ${r.content}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (meetings.length > 0) {
    const lines = ["## Meetings"];
    for (const m of meetings) {
      const when = m.scheduledAt ? formatDate(m.scheduledAt) : `requested ${formatDate(m.createdAt)}`;
      lines.push(`- [OutreachMeeting:${m.id}] ${m.title} [${m.status}] — ${when}${m.agenda ? `\n  Agenda: ${m.agenda}` : ""}`);
    }
    sections.push(lines.join("\n"));
  }

  if (tasks.length > 0) {
    const lines = ["## Tasks"];
    for (const t of tasks) {
      lines.push(
        `- [Task:${t.id}] ${t.title} [${t.status}]${t.dueDate ? ` — due ${formatDate(t.dueDate)}` : ""}${
          t.description ? `\n  ${t.description}` : ""
        }`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (opportunities.length > 0) {
    const lines = ["## Opportunities"];
    for (const o of opportunities) {
      lines.push(
        `- [LeadOpportunity:${o.id}] ${o.title} [${o.status}]${o.priority ? ` (priority: ${o.priority})` : ""}${
          o.estimatedValue != null ? ` — est. value ${o.estimatedValue}` : ""
        }\n  ${o.description}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (proposals.length > 0) {
    const lines = ["## Proposals"];
    for (const p of proposals) {
      const state = p.acceptedAt ? "ACCEPTED" : p.rejectedAt ? "REJECTED" : p.sentAt ? "SENT" : p.status;
      lines.push(`- [Proposal:${p.id}] ${p.title} [${state}]${p.value != null ? ` — value ${p.value}` : ""}`);
    }
    sections.push(lines.join("\n"));
  }

  if (deals.length > 0) {
    const lines = ["## Deals"];
    for (const d of deals) {
      lines.push(
        `- [Deal:${d.id}] ${d.name}${d.value != null ? ` — value ${d.value}` : ""}${
          d.probability != null ? `, ${d.probability}% probability` : ""
        }${d.expectedCloseDate ? `, expected close ${formatDate(d.expectedCloseDate)}` : ""}${d.notes ? `\n  Notes: ${d.notes}` : ""}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (evidence.length > 0) {
    const lines = ["## Evidence"];
    for (const e of evidence) {
      lines.push(`- [CompanyEvidence:${e.id}] (${e.kind}, confidence ${e.confidence}) ${e.fact}`);
    }
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * Answers a real, free-form question about one specific Company/its
 * contacts, grounded ONLY in that company's own real data (emails, replies,
 * meetings, tasks, opportunities, proposals, deals, evidence — see
 * buildClientContext above). Returns null when the company isn't found/
 * doesn't belong to this org, when AI isn't connected, or when the call
 * fails — never throws to the UI, matching this repo's analyzeReply idiom.
 */
export async function askAiAboutClient(organizationId: string, companyId: string, question: string): Promise<AskAiAboutClientResult | null> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) return null;

  const context = await buildClientContext(organizationId, companyId);
  if (context === null) return null;
  if (!isAIConnected()) return null;

  try {
    const result = await generateStructured({
      system: `You are answering a real question a member of our team is asking about a specific client/prospect. Below is the COMPLETE real context we have for this company — every line is tagged with its real record, like "[Reply:abc123]" or "[LeadOpportunity:xyz789]".

Answer ONLY from this real context. Never guess, never invent a fact, date, price, or commitment that isn't actually present below. If the answer genuinely isn't in the data, say so explicitly in "answer" (e.g. "That hasn't come up in any of the real conversation on file yet.") rather than speculating.

Return:
- "answer": your real, grounded answer to the question.
- "groundedIn": the exact "RecordType:id" tags (copied verbatim from the context, e.g. "Reply:abc123") of every real record your answer actually drew from. Empty array if the answer is "not in the data."`,
      userContent: `## Question\n${trimmedQuestion}\n\n${context}`,
      maxTokens: 1200,
      effort: "medium",
      schema: AskAiSchema,
    });
    return result.parsed;
  } catch (error) {
    console.error("[business-development] askAiAboutClient failed:", error);
    return null;
  }
}
