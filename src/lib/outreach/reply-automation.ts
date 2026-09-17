import { prisma } from "@/lib/prisma";
import type { MessagePriority, ReplyIntent } from "@/generated/prisma/client";

export interface ReplyAutomationResult {
  actionsApplied: string[];
  taskId: string | null;
  reminderId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

/**
 * "Next business day" — tomorrow, rolled forward past a weekend. No holiday
 * calendar; deliberately simple, same spirit as Task.recurrenceRule's
 * "no RRULE parser" note elsewhere in this codebase.
 */
function nextBusinessDay(): Date {
  const d = daysFromNow(1);
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

function fullName(contact: { firstName: string; lastName: string | null }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

/** Short, real excerpt of actual reply text — never a fabricated reason. */
function excerpt(text: string, max = 240): string {
  const trimmed = text.trim();
  if (!trimmed) return "(no additional detail in the reply)";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * MessagePriority (the real enum Task.priority/Reminder use) is
 * LOW/NORMAL/HIGH/URGENT — there is no MEDIUM value. Every "priority MEDIUM"
 * instruction in this module's spec maps to NORMAL, the closest real tier.
 */
function fallbackTaskPriority(intent: ReplyIntent | null): MessagePriority {
  if (intent === "INTERESTED") return "HIGH";
  if (intent === "NOT_INTERESTED" || intent === "UNSUBSCRIBE") return "LOW";
  return "NORMAL";
}

/**
 * Deterministic, non-AI reaction to an already-classified Reply — no new AI
 * call here, `analyzeReply` (reply-actions.ts) already did the
 * classification when the reply was logged. This function only ACTS on
 * `reply.intent`, which is real data already persisted on the row.
 *
 * Called from both real call sites right after a successful
 * `logReplyCore` — the session-gated `logReply` wrapper
 * (src/app/dashboard/outreach/_lib/reply-actions.ts) and
 * `runKvlReplySync`'s loop (src/lib/business-development/kvl-reply-sync-job.ts)
 * — always in its own try/catch there so an automation failure never makes
 * the underlying "reply was logged" action report failure.
 */
export async function applyReplyAutomation(replyId: string): Promise<ReplyAutomationResult> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    include: { contact: { include: { company: true } } },
  });
  if (!reply) return { actionsApplied: [], taskId: null, reminderId: null };

  const { contact } = reply;
  const company = contact.company;
  const name = fullName(contact);
  const companyName = company?.name ?? "their company";
  const assignedToUserId = contact.ownerUserId ?? reply.loggedByUserId;
  // Hoisted out of `reply` so the closures below don't reference a variable
  // TS can't narrow past a function boundary (control-flow narrowing on
  // `reply` doesn't cross into nested function declarations).
  const organizationId = reply.organizationId;
  const intent = reply.intent;
  const replyContent = reply.content;
  const replySuggestedResponse = reply.suggestedResponse;

  const actionsApplied: string[] = [];
  let taskId: string | null = null;
  let reminderId: string | null = null;

  async function createTask(input: { title: string; description: string; priority: MessagePriority; dueDate: Date }) {
    const task = await prisma.task.create({
      data: {
        organizationId,
        title: input.title,
        description: input.description,
        assignedToUserId,
        dueDate: input.dueDate,
        priority: input.priority,
        contactId: contact.id,
        companyId: contact.companyId ?? undefined,
      },
    });
    taskId = task.id;
    return task;
  }

  const groundedExcerpt = excerpt(replySuggestedResponse || replyContent);

  if (intent === null) {
    // AI was unavailable (or the call failed) when this reply was logged —
    // there is nothing real to act on, so no fabricated Task/Reminder.
    actionsApplied.push("unclassified");
  } else {
    switch (intent) {
      case "UNSUBSCRIBE": {
        // The one real override: sentiment-based Contact.status sync
        // (logReplyCore) could leave a neutral-sentiment "please remove me"
        // reply as REPLIED instead of UNSUBSCRIBED. Force it here.
        await prisma.contact.update({ where: { id: contact.id }, data: { status: "UNSUBSCRIBED" } });
        actionsApplied.push("unsubscribed");
        break;
      }
      case "REQUEST_CALL": {
        await createTask({
          title: `Schedule a call with ${name}`,
          description: `Reply asked for a call/meeting. Grounded in the reply: "${groundedExcerpt}"`,
          priority: "HIGH",
          dueDate: daysFromNow(2),
        });
        actionsApplied.push("meeting_task_created");
        break;
      }
      case "REQUEST_PROPOSAL": {
        await createTask({
          title: `Prepare proposal for ${name} at ${companyName}`,
          description: `Reply asked for a proposal/quote. Grounded in the reply: "${groundedExcerpt}"`,
          priority: "HIGH",
          dueDate: daysFromNow(3),
        });
        actionsApplied.push("proposal_task_created");
        break;
      }
      case "FOLLOW_UP_LATER": {
        // Fixed, documented 7-day default. Real date-parsing from the reply
        // text (e.g. "call me back in 2 weeks") is a known future
        // improvement, not attempted here — the AI classification doesn't
        // reliably extract a specific date, and guessing one would be a
        // fabrication.
        const reminder = await prisma.reminder.create({
          data: {
            organizationId,
            userId: assignedToUserId,
            title: `Follow up with ${name} — ${companyName}`,
            remindAt: daysFromNow(7),
            relatedContactId: contact.id,
            relatedCompanyId: contact.companyId ?? undefined,
          },
        });
        reminderId = reminder.id;
        actionsApplied.push("follow_up_reminder_created");
        break;
      }
      case "NEEDS_INFORMATION": {
        await createTask({
          title: `Answer ${name}'s question`,
          description: `Reply asked a general question. Grounded in the reply: "${groundedExcerpt}"`,
          priority: "NORMAL",
          dueDate: nextBusinessDay(),
        });
        actionsApplied.push("info_task_created");
        break;
      }
      case "PRICE_QUESTION": {
        await createTask({
          title: `Send pricing info to ${name}`,
          description: `Reply asked specifically about pricing/cost. Grounded in the reply: "${groundedExcerpt}"`,
          priority: "NORMAL",
          dueDate: nextBusinessDay(),
        });
        actionsApplied.push("pricing_task_created");
        break;
      }
      case "WRONG_CONTACT": {
        await createTask({
          title: `Find correct contact at ${companyName} — ${name} says this isn't their area`,
          description: `Reply indicated the wrong person was contacted. Grounded in the reply: "${groundedExcerpt}"`,
          priority: "LOW",
          dueDate: nextBusinessDay(),
        });
        actionsApplied.push("wrong_contact_task_created");
        break;
      }
      case "OUT_OF_OFFICE":
      case "UNKNOWN": {
        // A real classification, just not an actionable one — an
        // auto-reply or a genuinely ambiguous message shouldn't get a
        // fabricated Task.
        actionsApplied.push("no_action_needed");
        break;
      }
      case "INTERESTED":
      case "NOT_INTERESTED": {
        // Automation for these two is the Contact.status sync (already
        // done by logReplyCore) and the sequence-stop guard (already done
        // by advanceSequenceCore) — both real and both already happened
        // before this function is even called. No intent-specific Task
        // here; the universal fallback below still applies.
        break;
      }
      default: {
        // Exhaustiveness guard — fails to compile if a new ReplyIntent
        // value is ever added without a branch above.
        const exhaustive: never = intent;
        throw new Error(`applyReplyAutomation: unhandled ReplyIntent ${String(exhaustive)}`);
      }
    }
  }

  // Universal "Sales Task" guarantee: every classified reply gets exactly
  // one summary Task with a Next Action / Owner / Due Date / Reason, unless
  // a branch above already created one (or the reply genuinely isn't
  // actionable — OUT_OF_OFFICE / UNKNOWN / unclassified, which opted out
  // above).
  const exemptFromSummaryTask = intent === null || intent === "OUT_OF_OFFICE" || intent === "UNKNOWN";
  if (!exemptFromSummaryTask && taskId === null) {
    await createTask({
      title: `Review reply from ${name}`,
      description: `Intent: ${intent}. Reply excerpt: "${excerpt(replyContent)}"`,
      priority: fallbackTaskPriority(intent),
      dueDate: nextBusinessDay(),
    });
    actionsApplied.push("summary_task_created");
  }

  return { actionsApplied, taskId, reminderId };
}
