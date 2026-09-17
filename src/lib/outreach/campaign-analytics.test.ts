import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { getOutreachDashboardStats } from "./campaign-analytics";

// Real local-Postgres integration test (no mocking of Prisma, matching the
// rest of this repo's Prisma-touching code, e.g. dedup.test.ts and
// opportunity-actions.test.ts) — everything is scoped under a single
// throwaway Organization created here and deleted in afterAll (cascades to
// every Membership/Workspace/DealStage/Company/Contact/Campaign/EmailDraft/
// Reply/OutreachMeeting/Task/Deal created during the test).
describe("getOutreachDashboardStats", () => {
  let orgId: string;
  let userId: string;
  let stageWonId: string;
  let stageOpenId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Campaign Analytics Test Org", slug: `campaign-analytics-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "Campaign Analytics Test User", email: `campaign-analytics-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const wonStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Won", order: 0 } });
    stageWonId = wonStage.id;
    const openStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Negotiation", order: 1 } });
    stageOpenId = openStage.id;

    // --- Companies: one that converted (has a Won deal), one that has an
    // open (non-Won) deal, and contacts with no company at all. ---
    const wonCompany = await prisma.company.create({
      data: { organizationId: orgId, name: "Won Co", status: "CLIENT" },
    });
    const openCompany = await prisma.company.create({
      data: { organizationId: orgId, name: "Open Co", status: "PROSPECT" },
    });

    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: stageWonId, companyId: wonCompany.id, name: "Won Co — Deal" },
    });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: stageOpenId, companyId: openCompany.id, name: "Open Co — Deal" },
    });

    // --- Contacts ---
    const convertedContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: wonCompany.id, firstName: "Won", lastName: "Contact", email: `won-contact-${suffix}@example.com` },
    });
    await prisma.contact.create({
      data: { organizationId: orgId, companyId: openCompany.id, firstName: "Open", lastName: "Contact", email: `open-contact-${suffix}@example.com` },
    });
    const interestedContact = await prisma.contact.create({
      data: { organizationId: orgId, firstName: "Interested", lastName: "Contact", email: `interested-contact-${suffix}@example.com`, status: "INTERESTED" },
    });
    await prisma.contact.create({
      data: { organizationId: orgId, firstName: "NotInterested", lastName: "Contact", email: `not-interested-contact-${suffix}@example.com`, status: "NOT_INTERESTED" },
    });

    // --- Campaign ---
    const campaign = await prisma.campaign.create({
      data: { organizationId: orgId, name: "Test Campaign", type: "STANDARD", createdByUserId: userId },
    });

    // --- EmailDrafts: exercises sent/delivered/opened/clicked plus the
    // pre-existing emailsPrepared (ALL rows regardless of status) and
    // pending (DRAFT/PENDING_APPROVAL/APPROVED/QUEUED) fields. ---
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaign.id,
        contactId: convertedContact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: "Sent, opened, clicked, not bounced.",
        status: "SENT",
        openCount: 2,
        firstOpenedAt: new Date(),
        clickCount: 1,
        firstClickedAt: new Date(),
      },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaign.id,
        contactId: interestedContact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: "Sent but bounced — never opened or clicked.",
        status: "SENT",
        bouncedAt: new Date(),
        bounceReason: "mailbox_full",
      },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaign.id,
        contactId: interestedContact.id,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        body: "Still a draft.",
        status: "DRAFT",
      },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaign.id,
        contactId: interestedContact.id,
        channel: "EMAIL",
        purpose: "FOLLOW_UP",
        tone: "PROFESSIONAL",
        body: "Failed to send.",
        status: "FAILED",
        failedReason: "smtp_error",
      },
    });

    // --- Reply / OutreachMeeting / Task — pre-existing fields must stay correct. ---
    await prisma.reply.create({
      data: {
        organizationId: orgId,
        contactId: interestedContact.id,
        campaignId: campaign.id,
        channel: "EMAIL",
        content: "Sounds interesting, tell me more.",
        sentiment: "POSITIVE",
        loggedByUserId: userId,
      },
    });
    await prisma.outreachMeeting.create({
      data: {
        organizationId: orgId,
        contactId: interestedContact.id,
        campaignId: campaign.id,
        title: "Intro call",
        status: "CONFIRMED",
      },
    });
    await prisma.task.create({
      data: {
        organizationId: orgId,
        contactId: interestedContact.id,
        title: "Follow up with interested contact",
        status: "PENDING",
      },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { organizationId: orgId } });
    await prisma.outreachMeeting.deleteMany({ where: { organizationId: orgId } });
    await prisma.reply.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.deal.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.dealStage.deleteMany({ where: { workspace: { organizationId: orgId } } });
    await prisma.workspace.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });

    const [remainingContacts, remainingDeals, remainingDrafts, remainingOrg] = await Promise.all([
      prisma.contact.count({ where: { organizationId: orgId } }),
      prisma.deal.count({ where: { organizationId: orgId } }),
      prisma.emailDraft.count({ where: { organizationId: orgId } }),
      prisma.organization.count({ where: { id: orgId } }),
    ]);
    expect(remainingContacts).toBe(0);
    expect(remainingDeals).toBe(0);
    expect(remainingDrafts).toBe(0);
    expect(remainingOrg).toBe(0);
  });

  it("computes the new Sent/Delivered/Opened/Clicked/Converted metrics honestly from real fixture data", async () => {
    const stats = await getOutreachDashboardStats(orgId);

    expect(stats.sent).toBe(2); // 2 EmailDrafts with status SENT (one bounced, one clean)
    expect(stats.delivered).toBe(1); // SENT AND bouncedAt IS NULL
    expect(stats.opened).toBe(1); // SENT AND openCount > 0
    expect(stats.clicked).toBe(1); // SENT AND clickCount > 0
    expect(stats.converted).toBe(1); // 1 Contact whose Company has a Won Deal
  });

  it("leaves every pre-existing field unaffected by the new metrics", async () => {
    const stats = await getOutreachDashboardStats(orgId);

    expect(stats.campaigns).toBe(1);
    expect(stats.emailsPrepared).toBe(4); // ALL EmailDraft rows regardless of status
    expect(stats.replies).toBe(1);
    expect(stats.meetings).toBe(1); // CONFIRMED
    expect(stats.interested).toBe(1);
    expect(stats.notInterested).toBe(1);
    expect(stats.pending).toBe(1); // the one DRAFT-status EmailDraft
    expect(stats.tasks).toBe(1);
  });

  it("stat interface exposes exactly the documented field set with no stray placeholder metrics", async () => {
    const stats = await getOutreachDashboardStats(orgId);
    const keys = Object.keys(stats).sort();
    expect(keys).toEqual(
      [
        "campaigns",
        "clicked",
        "converted",
        "delivered",
        "emailsPrepared",
        "interested",
        "meetings",
        "notInterested",
        "opened",
        "pending",
        "replies",
        "sent",
        "tasks",
      ].sort(),
    );
  });
});
