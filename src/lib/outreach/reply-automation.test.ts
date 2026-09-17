import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { ReplyIntent } from "@/generated/prisma/client";

import { applyReplyAutomation } from "./reply-automation";

// Real local-Postgres integration test (no mocking of Prisma, matching the
// rest of this repo's Prisma-touching code, e.g. campaign-analytics.test.ts
// and dedup.test.ts) — everything is scoped under a single throwaway
// Organization created here and deleted in afterAll (cascades to every
// Membership/Contact/Company/Reply/Task/Reminder created during the test).
describe("applyReplyAutomation", () => {
  let orgId: string;
  let userId: string;
  let companyId: string;
  let contactId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Reply Automation Test Org", slug: `reply-automation-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "Reply Automation Test User", email: `reply-automation-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Reply Automation Test Co", status: "PROSPECT" },
    });
    companyId = company.id;

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "Riley",
        lastName: "Prospect",
        email: `riley-prospect-${suffix}@example.com`,
        ownerUserId: userId,
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.reminder.deleteMany({ where: { organizationId: orgId } });
    await prisma.task.deleteMany({ where: { organizationId: orgId } });
    await prisma.reply.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });

    const [remainingReminders, remainingTasks, remainingReplies, remainingOrg] = await Promise.all([
      prisma.reminder.count({ where: { organizationId: orgId } }),
      prisma.task.count({ where: { organizationId: orgId } }),
      prisma.reply.count({ where: { organizationId: orgId } }),
      prisma.organization.count({ where: { id: orgId } }),
    ]);
    expect(remainingReminders).toBe(0);
    expect(remainingTasks).toBe(0);
    expect(remainingReplies).toBe(0);
    expect(remainingOrg).toBe(0);
  });

  async function makeReply(intent: ReplyIntent | null, content: string, suggestedResponse?: string) {
    return prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId,
        channel: "EMAIL",
        content,
        intent,
        intentConfidence: intent ? 0.9 : null,
        suggestedResponse: suggestedResponse ?? null,
        loggedByUserId: userId,
      },
    });
  }

  it("REQUEST_CALL creates a HIGH-priority Task due in 2 days, assigned to the contact owner", async () => {
    const reply = await makeReply("REQUEST_CALL", "Can we hop on a call this week?", "Sure, let's set up a call.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["meeting_task_created"]);
    expect(result.taskId).toBeTruthy();
    expect(result.reminderId).toBeNull();

    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Schedule a call with Riley Prospect");
    expect(task.priority).toBe("HIGH");
    expect(task.assignedToUserId).toBe(userId);
    expect(task.contactId).toBe(contactId);
    expect(task.companyId).toBe(companyId);
    expect(task.description).toContain("let's set up a call");
    expect(task.dueDate).toBeTruthy();
    const daysOut = (task.dueDate!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(1);
    expect(daysOut).toBeLessThan(3);
  });

  it("REQUEST_PROPOSAL creates a HIGH-priority proposal Task", async () => {
    const reply = await makeReply("REQUEST_PROPOSAL", "Please send over a formal proposal with pricing.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["proposal_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Prepare proposal for Riley Prospect at Reply Automation Test Co");
    expect(task.priority).toBe("HIGH");
  });

  it("FOLLOW_UP_LATER creates a Reminder ~7 days out AND a summary Task (no branch-specific Task was made)", async () => {
    const reply = await makeReply("FOLLOW_UP_LATER", "Not right now, check back with me in a couple weeks.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["follow_up_reminder_created", "summary_task_created"]);
    expect(result.reminderId).toBeTruthy();
    expect(result.taskId).toBeTruthy();

    const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: result.reminderId! } });
    expect(reminder.title).toBe("Follow up with Riley Prospect — Reply Automation Test Co");
    expect(reminder.relatedContactId).toBe(contactId);
    expect(reminder.relatedCompanyId).toBe(companyId);
    const daysOut = (reminder.remindAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(6);
    expect(daysOut).toBeLessThan(8);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Review reply from Riley Prospect");
    expect(task.description).toContain("FOLLOW_UP_LATER");
  });

  it("NEEDS_INFORMATION creates a NORMAL-priority Task due next business day", async () => {
    const reply = await makeReply("NEEDS_INFORMATION", "What integrations do you support?");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["info_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Answer Riley Prospect's question");
    expect(task.priority).toBe("NORMAL");
  });

  it("PRICE_QUESTION creates a NORMAL-priority pricing Task", async () => {
    const reply = await makeReply("PRICE_QUESTION", "How much does this cost per month?");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["pricing_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Send pricing info to Riley Prospect");
    expect(task.priority).toBe("NORMAL");
  });

  it("WRONG_CONTACT creates a LOW-priority Task", async () => {
    const reply = await makeReply("WRONG_CONTACT", "This isn't my area, try our ops team instead.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["wrong_contact_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Find correct contact at Reply Automation Test Co — Riley Prospect says this isn't their area");
    expect(task.priority).toBe("LOW");
  });

  it("OUT_OF_OFFICE creates no Task/Reminder", async () => {
    const reply = await makeReply("OUT_OF_OFFICE", "I am out of the office until next Monday.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["no_action_needed"]);
    expect(result.taskId).toBeNull();
    expect(result.reminderId).toBeNull();
  });

  it("UNKNOWN creates no Task/Reminder", async () => {
    const reply = await makeReply("UNKNOWN", "??");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["no_action_needed"]);
    expect(result.taskId).toBeNull();
    expect(result.reminderId).toBeNull();
  });

  it("null intent (AI unavailable) creates no Task/Reminder and is marked unclassified", async () => {
    const reply = await makeReply(null, "Some reply logged while AI was disconnected.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["unclassified"]);
    expect(result.taskId).toBeNull();
    expect(result.reminderId).toBeNull();
  });

  it("INTERESTED gets a universal summary Task (HIGH priority) since no branch-specific Task exists", async () => {
    const reply = await makeReply("INTERESTED", "This looks great, let's move forward.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["summary_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Review reply from Riley Prospect");
    expect(task.priority).toBe("HIGH");
    expect(task.description).toContain("INTERESTED");
  });

  it("NOT_INTERESTED gets a universal summary Task (LOW priority)", async () => {
    const reply = await makeReply("NOT_INTERESTED", "Not a fit for us right now.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["summary_task_created"]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.priority).toBe("LOW");
  });

  it("UNSUBSCRIBE forces Contact.status to UNSUBSCRIBED even from a non-obvious prior status, and still gets a summary Task", async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { status: "MEETING_BOOKED" } });

    const reply = await makeReply("UNSUBSCRIBE", "Please remove me from your list, I'm not interested going forward but thanks.");
    const result = await applyReplyAutomation(reply.id);

    expect(result.actionsApplied).toEqual(["unsubscribed", "summary_task_created"]);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.status).toBe("UNSUBSCRIBED");

    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task.title).toBe("Review reply from Riley Prospect");
    expect(task.priority).toBe("LOW");

    // Reset for any tests that might run after this one in the same file.
    await prisma.contact.update({ where: { id: contactId }, data: { status: "NEW" } });
  });

  it("returns an empty result for a Reply id that does not exist", async () => {
    const result = await applyReplyAutomation("nonexistent-reply-id");
    expect(result).toEqual({ actionsApplied: [], taskId: null, reminderId: null });
  });
});
