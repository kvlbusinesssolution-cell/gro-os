import { prisma } from "@/lib/prisma";
import type { DraftStatus, ReplyIntent } from "@/generated/prisma/client";

export interface CompanyNextAction {
  action: string;
  taskId: string | null;
}

/** Real, non-terminal Task statuses — same list used elsewhere (e.g. context-engine.ts's upcomingTasks query). */
const OPEN_TASK_STATUSES = ["PENDING", "RUNNING", "BLOCKED", "BACKLOG", "REVIEW", "TESTING", "READY_FOR_CLIENT"] as const;

/** Deterministic fallback suggestion when no real open Task already covers this intent — never itself creates a Task. */
function fallbackActionForIntent(intent: ReplyIntent): string {
  switch (intent) {
    case "INTERESTED":
      return "Follow up with the interested contact";
    case "NEEDS_INFORMATION":
      return "Answer the client's question";
    case "REQUEST_CALL":
      return "Schedule a call with the client";
    case "REQUEST_PROPOSAL":
      return "Prepare a proposal for the client";
    case "FOLLOW_UP_LATER":
      return "Follow up with the client later (a reminder is set)";
    case "PRICE_QUESTION":
      return "Send pricing information to the client";
    case "WRONG_CONTACT":
      return "Find the correct contact at this company";
    case "OUT_OF_OFFICE":
      return "No action needed — the contact's reply was an out-of-office auto-reply";
    case "UNSUBSCRIBE":
      return "Stop outreach — the contact asked to be removed";
    case "NOT_INTERESTED":
      return "Stop outreach — the contact isn't interested";
    case "UNKNOWN":
      return "Review the reply manually — its intent wasn't clear";
    default: {
      const exhaustive: never = intent;
      throw new Error(`suggestNextActionForCompany: unhandled ReplyIntent ${String(exhaustive)}`);
    }
  }
}

function actionForDraftStatus(status: DraftStatus): string {
  switch (status) {
    case "DRAFT":
    case "PENDING_APPROVAL":
      return "Approve outreach draft";
    case "APPROVED":
      return "Outreach approved — queue it to send";
    case "QUEUED":
      return "Outreach queued to send";
    case "SENT":
      return "Waiting for client reply";
    case "FAILED":
      return "Outreach failed to send — review and retry";
    case "REJECTED":
      return "Draft was rejected — revise it or start new outreach";
    case "BOUNCED":
      return "Email bounced — verify the contact's email address";
    default: {
      const exhaustive: never = status;
      throw new Error(`suggestNextActionForCompany: unhandled DraftStatus ${String(exhaustive)}`);
    }
  }
}

/**
 * Deterministic (no AI call) heuristic over this Company's real state —
 * cheap, fast, always available even when no AI provider is configured.
 * Primarily SURFACES the real Task already created by
 * src/lib/outreach/reply-automation.ts's applyReplyAutomation (which runs
 * right after every logged reply) rather than creating a second one; only
 * falls back to a plain suggested-action string when no real open Task
 * covers the latest reply yet.
 */
export async function suggestNextActionForCompany(organizationId: string, companyId: string): Promise<CompanyNextAction> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, organizationId: true },
  });
  if (!company || company.organizationId !== organizationId) {
    return { action: "Company not found.", taskId: null };
  }

  const contacts = await prisma.contact.findMany({
    where: { companyId, organizationId },
    select: { id: true },
  });
  const contactIds = contacts.map((c) => c.id);

  if (contactIds.length === 0) {
    return { action: "Add a contact to start outreach", taskId: null };
  }

  const latestReply = await prisma.reply.findFirst({
    where: { contactId: { in: contactIds }, organizationId },
    orderBy: { receivedAt: "desc" },
    select: { id: true, contactId: true, intent: true, receivedAt: true },
  });

  if (latestReply) {
    if (latestReply.intent === null) {
      return { action: "Review the reply manually — AI classification wasn't available", taskId: null };
    }

    // The real Task reply-automation.ts would have created right after this
    // reply was logged, if any — surfaced here, never re-created.
    const openTask = await prisma.task.findFirst({
      where: {
        organizationId,
        companyId,
        contactId: latestReply.contactId,
        status: { in: [...OPEN_TASK_STATUSES] },
        createdAt: { gte: latestReply.receivedAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    });

    if (openTask) {
      return { action: `Task in progress: "${openTask.title}"`, taskId: openTask.id };
    }

    return { action: fallbackActionForIntent(latestReply.intent), taskId: null };
  }

  const latestDraft = await prisma.emailDraft.findFirst({
    where: { contactId: { in: contactIds }, organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (!latestDraft) {
    return { action: "No outreach started yet for this company", taskId: null };
  }

  return { action: actionForDraftStatus(latestDraft.status), taskId: null };
}
