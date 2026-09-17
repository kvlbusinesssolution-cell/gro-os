import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { computeAcquisitionOverview } from "./acquisition-funnel";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Real local-Postgres integration test (no mocking of Prisma), matching the
 * established convention (e.g. src/lib/outreach/campaign-analytics.test.ts).
 *
 * Fixture spans the WHOLE funnel across 3 real, "recent" companies with
 * different `CompanySource` values, plus one deliberately "old" company
 * (400 days back) used only to prove the `dateRange` filter genuinely
 * excludes out-of-range rows. All numbers below are hand-counted and
 * asserted exactly.
 *
 * ===== Recent fixture (all rows default to `now()`) =====
 * Company A — LEAD_FINDER, industry "Software", country "USA"
 *   LeadScore HOT (qualified) · LeadOpportunity WEBSITE_DEVELOPMENT
 *   Contact A1 · EmailDraft SENT · Reply · OutreachMeeting CONFIRMED
 *   Proposal SENT · Deal Won $10,000 · Deal Won $5,000
 * Company B — WEBSITE_SCANNER, industry "Software", country "UK"
 *   LeadScore WARM (qualified) · LeadOpportunity WEBSITE_DEVELOPMENT
 *   Contact B1 · EmailDraft SENT · Reply · OutreachMeeting REQUESTED (not "real")
 *   Proposal DRAFT · Deal Won $8,000
 * Company C — REFERRAL, industry "Healthcare", country "USA"
 *   LeadScore COLD (NOT qualified) · LeadOpportunity SEO
 *   Contact C1 · EmailDraft DRAFT (not sent) · OutreachMeeting COMPLETED
 *   Deal Negotiation (open, NOT Won) $20,000 — must never count as revenue
 * Contact D — no company at all (still counts toward the Contacts stage)
 *
 * ===== Campaign fixture (all rows default to `now()`) =====
 * Campaign X — CampaignContact: Contact A1 (Company A) + Contact C1 (Company C)
 *   Contact A1's EmailDraft/Reply/OutreachMeeting(CONFIRMED) linked to X
 *   Contact C1's OutreachMeeting(COMPLETED) also linked to X
 * Campaign Y — CampaignContact: Contact A1 (Company A, ALSO in X) + Contact B1 (Company B)
 *   Contact B1's EmailDraft/Reply/OutreachMeeting(REQUESTED, not "real") linked to Y
 * (Contact A1 deliberately enrolled in both campaigns to exercise the
 * documented multi-campaign Won-deal attribution case.)
 *
 * ===== Hand-calculated expectations (all-time) =====
 * funnel: Companies 4 (3 recent + 1 old) · Qualified Leads 3 (A, B, old) ·
 *   Opportunities 4 · Contacts 4 · Outreach Sent 2 · Replies 2 · Meetings 2
 *   (A CONFIRMED + C COMPLETED; B's REQUESTED does not count) · Proposals 2 ·
 *   Won Deals 4 (A×2, B×1, old×1)
 * totalRevenue: 10000 + 5000 + 8000 + 999 (old) = 23999
 * bySource: LEAD_FINDER {companies:1, qualifiedLeads:1, opportunities:1,
 *   meetings:1, proposals:1, wonDeals:2, revenue:15000}; WEBSITE_SCANNER
 *   {1,1,1,0,1,1,8000}; REFERRAL {1,0,1,1,0,0,0}; MANUAL {1,1,1,0,0,1,999}
 *   (the old company); CLIENT_FINDER/AUTO_DISCOVERY all zero.
 * byIndustry: Software {companies:2, wonDeals:3, revenue:23000}; Healthcare
 *   {1,0,0}; "Old Industry" {1,1,999}.
 * byCountry: USA {companies:2, wonDeals:2, revenue:15000}; UK {1,1,8000};
 *   "Oldland" {1,1,999}.
 * byService: WEBSITE_DEVELOPMENT {opportunities:2, wonDeals:3, revenue:23000}
 *   (company A's 2 won deals + company B's 1); SEO {1,0,0}; CRM {1,1,999}.
 * byCampaign: Campaign X {contactsEnrolled:2, emailsSent:1, replies:1,
 *   meetings:2, wonDeals:2, revenue:15000} (Company A's Won deals only —
 *   Company C has none); Campaign Y {contactsEnrolled:2, emailsSent:1,
 *   replies:1, meetings:0, wonDeals:3, revenue:23000} (Company A's 2 Won
 *   deals + Company B's 1 — Company A is double-counted here on purpose,
 *   since Contact A1 is independently enrolled in both campaigns).
 */
describe("computeAcquisitionOverview", () => {
  let orgId: string;
  let userId: string;
  let wonStageId: string;
  let openStageId: string;
  let companyAId: string;
  let companyBId: string;
  let companyCId: string;
  let companyOldId: string;
  let campaignXId: string;
  let campaignYId: string;

  let emptyOrgId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Acquisition Funnel Test Org", slug: `acquisition-funnel-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "Acquisition Funnel Test User", email: `acquisition-funnel-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "Workspace" } });
    const wonStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Won", order: 0 } });
    wonStageId = wonStage.id;
    const openStage = await prisma.dealStage.create({ data: { workspaceId: workspace.id, name: "Negotiation", order: 1 } });
    openStageId = openStage.id;

    // ===== Two real Campaigns, used to test `byCampaign` — created up front
    // so their ids are available while wiring `campaignId` onto the
    // EmailDraft/Reply/OutreachMeeting rows created below. Deliberately
    // overlapping enrollment (Contact A1 is enrolled in BOTH) to exercise the
    // documented multi-campaign-attribution case for wonDeals/revenue. =====
    const campaignX = await prisma.campaign.create({
      data: { organizationId: orgId, name: "Campaign X", type: "STANDARD", createdByUserId: userId },
    });
    campaignXId = campaignX.id;
    const campaignY = await prisma.campaign.create({
      data: { organizationId: orgId, name: "Campaign Y", type: "STANDARD", createdByUserId: userId },
    });
    campaignYId = campaignY.id;

    // ===== Company A — LEAD_FINDER, qualified (HOT), Won ×2 =====
    const companyA = await prisma.company.create({
      data: { organizationId: orgId, name: "Company A", source: "LEAD_FINDER", industry: "Software", headquartersCountry: "USA" },
    });
    companyAId = companyA.id;
    await prisma.leadScore.create({
      data: {
        companyId: companyA.id,
        industryMatchScore: 10,
        companySizeScore: 10,
        growthScore: 10,
        technologyFitScore: 10,
        opportunitySizeScore: 10,
        budgetPotentialScore: 10,
        locationScore: 10,
        digitalMaturityScore: 10,
        automationNeedScore: 10,
        overallScore: 90,
        band: "HOT",
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: companyA.id,
        category: "Website",
        title: "Rebuild marketing site",
        description: "Outdated site.",
        estimatedImpact: "High",
        evidence: "Old CMS detected.",
        confidenceScore: 80,
        recommendedService: "WEBSITE_DEVELOPMENT",
      },
    });
    const contactA1 = await prisma.contact.create({
      data: { organizationId: orgId, companyId: companyA.id, firstName: "A1", lastName: "Contact", email: `a1-${suffix}@example.com` },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaignXId,
        contactId: contactA1.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: "Hello A1",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.reply.create({
      data: { organizationId: orgId, campaignId: campaignXId, contactId: contactA1.id, channel: "EMAIL", content: "Interested.", loggedByUserId: userId },
    });
    await prisma.outreachMeeting.create({
      data: { organizationId: orgId, campaignId: campaignXId, contactId: contactA1.id, title: "A1 intro call", status: "CONFIRMED" },
    });
    await prisma.proposal.create({
      data: { organizationId: orgId, companyId: companyA.id, title: "Proposal A", content: "Content A", status: "SENT" },
    });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStageId, companyId: companyA.id, name: "Deal A1", value: 10000 },
    });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStageId, companyId: companyA.id, name: "Deal A2", value: 5000 },
    });

    // ===== Company B — WEBSITE_SCANNER, qualified (WARM), Won ×1 =====
    const companyB = await prisma.company.create({
      data: { organizationId: orgId, name: "Company B", source: "WEBSITE_SCANNER", industry: "Software", headquartersCountry: "UK" },
    });
    companyBId = companyB.id;
    await prisma.leadScore.create({
      data: {
        companyId: companyB.id,
        industryMatchScore: 5,
        companySizeScore: 5,
        growthScore: 5,
        technologyFitScore: 5,
        opportunitySizeScore: 5,
        budgetPotentialScore: 5,
        locationScore: 5,
        digitalMaturityScore: 5,
        automationNeedScore: 5,
        overallScore: 55,
        band: "WARM",
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: companyB.id,
        category: "Website",
        title: "New site",
        description: "No site yet.",
        estimatedImpact: "High",
        evidence: "No website found.",
        confidenceScore: 70,
        recommendedService: "WEBSITE_DEVELOPMENT",
      },
    });
    const contactB1 = await prisma.contact.create({
      data: { organizationId: orgId, companyId: companyB.id, firstName: "B1", lastName: "Contact", email: `b1-${suffix}@example.com` },
    });
    await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        campaignId: campaignYId,
        contactId: contactB1.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: "Hello B1",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.reply.create({
      data: { organizationId: orgId, campaignId: campaignYId, contactId: contactB1.id, channel: "EMAIL", content: "Maybe later.", loggedByUserId: userId },
    });
    await prisma.outreachMeeting.create({
      // REQUESTED, not CONFIRMED/COMPLETED — must NOT count toward "real" meetings.
      data: { organizationId: orgId, campaignId: campaignYId, contactId: contactB1.id, title: "B1 requested call", status: "REQUESTED" },
    });
    await prisma.proposal.create({
      data: { organizationId: orgId, companyId: companyB.id, title: "Proposal B", content: "Content B", status: "DRAFT" },
    });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStageId, companyId: companyB.id, name: "Deal B1", value: 8000 },
    });

    // ===== Company C — REFERRAL, NOT qualified (COLD), no Won deal =====
    const companyC = await prisma.company.create({
      data: { organizationId: orgId, name: "Company C", source: "REFERRAL", industry: "Healthcare", headquartersCountry: "USA" },
    });
    companyCId = companyC.id;
    await prisma.leadScore.create({
      data: {
        companyId: companyC.id,
        industryMatchScore: 1,
        companySizeScore: 1,
        growthScore: 1,
        technologyFitScore: 1,
        opportunitySizeScore: 1,
        budgetPotentialScore: 1,
        locationScore: 1,
        digitalMaturityScore: 1,
        automationNeedScore: 1,
        overallScore: 10,
        band: "COLD",
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: companyC.id,
        category: "Marketing",
        title: "SEO overhaul",
        description: "Poor rankings.",
        estimatedImpact: "Medium",
        evidence: "Low organic traffic.",
        confidenceScore: 60,
        recommendedService: "SEO",
      },
    });
    const contactC1 = await prisma.contact.create({
      data: { organizationId: orgId, companyId: companyC.id, firstName: "C1", lastName: "Contact", email: `c1-${suffix}@example.com` },
    });
    await prisma.emailDraft.create({
      // DRAFT — never sent — must NOT count toward "Outreach Sent".
      data: { organizationId: orgId, contactId: contactC1.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Draft only", status: "DRAFT" },
    });
    await prisma.outreachMeeting.create({
      data: { organizationId: orgId, campaignId: campaignXId, contactId: contactC1.id, title: "C1 completed call", status: "COMPLETED" },
    });
    await prisma.deal.create({
      // Open stage — must NEVER count as Won/revenue.
      data: { organizationId: orgId, dealStageId: openStageId, companyId: companyC.id, name: "Deal C1 (open)", value: 20000 },
    });

    // Contact with no company at all — still a real Contact.
    await prisma.contact.create({
      data: { organizationId: orgId, firstName: "D", lastName: "NoCompany", email: `d-${suffix}@example.com` },
    });

    // ===== Campaign enrollment — Contact A1 is enrolled in BOTH Campaign X
    // and Campaign Y (multi-attribution fixture for wonDeals/revenue).
    // Campaign X: Contact A1 (Company A) + Contact C1 (Company C, no Won deal).
    // Campaign Y: Contact A1 (Company A) + Contact B1 (Company B). =====
    await prisma.campaignContact.createMany({
      data: [
        { campaignId: campaignXId, contactId: contactA1.id },
        { campaignId: campaignXId, contactId: contactC1.id },
        { campaignId: campaignYId, contactId: contactA1.id },
        { campaignId: campaignYId, contactId: contactB1.id },
      ],
    });

    // ===== "Old" company — 400 days back, used only for the dateRange test =====
    const oldDate = new Date(Date.now() - 400 * DAY_MS);
    const companyOld = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: "Old Co",
        source: "MANUAL",
        industry: "Old Industry",
        headquartersCountry: "Oldland",
        createdAt: oldDate,
      },
    });
    companyOldId = companyOld.id;
    await prisma.leadScore.create({
      data: {
        companyId: companyOld.id,
        industryMatchScore: 9,
        companySizeScore: 9,
        growthScore: 9,
        technologyFitScore: 9,
        opportunitySizeScore: 9,
        budgetPotentialScore: 9,
        locationScore: 9,
        digitalMaturityScore: 9,
        automationNeedScore: 9,
        overallScore: 85,
        band: "HOT",
        scoredAt: oldDate,
      },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: companyOld.id,
        category: "CRM",
        title: "CRM rollout",
        description: "No CRM in place.",
        estimatedImpact: "High",
        evidence: "Spreadsheet-based sales tracking.",
        confidenceScore: 75,
        recommendedService: "CRM",
        createdAt: oldDate,
      },
    });
    await prisma.deal.create({
      data: { organizationId: orgId, dealStageId: wonStageId, companyId: companyOld.id, name: "Old Deal", value: 999, createdAt: oldDate },
    });

    // ===== A completely separate, empty organization — the all-zero test =====
    const emptyOrg = await prisma.organization.create({
      data: { name: "Acquisition Funnel Empty Org", slug: `acquisition-funnel-empty-org-${suffix}` },
    });
    emptyOrgId = emptyOrg.id;
  });

  afterAll(async () => {
    await prisma.deal.deleteMany({ where: { organizationId: orgId } });
    await prisma.proposal.deleteMany({ where: { organizationId: orgId } });
    await prisma.outreachMeeting.deleteMany({ where: { organizationId: orgId } });
    await prisma.reply.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    // Cascades to CampaignContact automatically (onDelete: Cascade).
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.leadOpportunity.deleteMany({ where: { company: { organizationId: orgId } } });
    await prisma.leadScore.deleteMany({ where: { company: { organizationId: orgId } } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.dealStage.deleteMany({ where: { workspace: { organizationId: orgId } } });
    await prisma.workspace.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: emptyOrgId } });
    await prisma.user.delete({ where: { id: userId } });

    const [remainingCompanies, remainingDeals, remainingOrgs, remainingUser, remainingCampaigns, remainingCampaignContacts] = await Promise.all([
      prisma.company.count({ where: { organizationId: orgId } }),
      prisma.deal.count({ where: { organizationId: orgId } }),
      prisma.organization.count({ where: { id: { in: [orgId, emptyOrgId] } } }),
      prisma.user.count({ where: { id: userId } }),
      prisma.campaign.count({ where: { organizationId: orgId } }),
      prisma.campaignContact.count({ where: { campaignId: { in: [campaignXId, campaignYId] } } }),
    ]);
    expect(remainingCompanies).toBe(0);
    expect(remainingDeals).toBe(0);
    expect(remainingOrgs).toBe(0);
    expect(remainingUser).toBe(0);
    expect(remainingCampaigns).toBe(0);
    expect(remainingCampaignContacts).toBe(0);
  });

  it("computes every funnel stage and totalRevenue exactly, all-time", async () => {
    const overview = await computeAcquisitionOverview(orgId);

    expect(overview.funnel).toEqual([
      { stage: "Companies", count: 4 },
      { stage: "Qualified Leads", count: 3 },
      { stage: "Opportunities", count: 4 },
      { stage: "Contacts", count: 4 },
      { stage: "Outreach Sent", count: 2 },
      { stage: "Replies", count: 2 },
      { stage: "Meetings", count: 2 },
      { stage: "Proposals", count: 2 },
      { stage: "Won Deals", count: 4 },
    ]);
    expect(overview.totalRevenue).toBe(23999);
  });

  it("computes bySource exactly for every real CompanySource value", async () => {
    const overview = await computeAcquisitionOverview(orgId);

    expect(overview.bySource).toEqual([
      { source: "MANUAL", companies: 1, qualifiedLeads: 1, opportunities: 1, meetings: 0, proposals: 0, wonDeals: 1, revenue: 999 },
      { source: "LEAD_FINDER", companies: 1, qualifiedLeads: 1, opportunities: 1, meetings: 1, proposals: 1, wonDeals: 2, revenue: 15000 },
      { source: "CLIENT_FINDER", companies: 0, qualifiedLeads: 0, opportunities: 0, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
      { source: "WEBSITE_SCANNER", companies: 1, qualifiedLeads: 1, opportunities: 1, meetings: 0, proposals: 1, wonDeals: 1, revenue: 8000 },
      { source: "AUTO_DISCOVERY", companies: 0, qualifiedLeads: 0, opportunities: 0, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
      { source: "REFERRAL", companies: 1, qualifiedLeads: 0, opportunities: 1, meetings: 1, proposals: 0, wonDeals: 0, revenue: 0 },
    ]);
  });

  it("computes byIndustry and byCountry exactly, joined via Company", async () => {
    const overview = await computeAcquisitionOverview(orgId);

    const software = overview.byIndustry.find((i) => i.industry === "Software");
    const healthcare = overview.byIndustry.find((i) => i.industry === "Healthcare");
    const oldIndustry = overview.byIndustry.find((i) => i.industry === "Old Industry");
    expect(software).toEqual({ industry: "Software", companies: 2, wonDeals: 3, revenue: 23000 });
    expect(healthcare).toEqual({ industry: "Healthcare", companies: 1, wonDeals: 0, revenue: 0 });
    expect(oldIndustry).toEqual({ industry: "Old Industry", companies: 1, wonDeals: 1, revenue: 999 });

    const usa = overview.byCountry.find((c) => c.country === "USA");
    const uk = overview.byCountry.find((c) => c.country === "UK");
    const oldland = overview.byCountry.find((c) => c.country === "Oldland");
    expect(usa).toEqual({ country: "USA", companies: 2, wonDeals: 2, revenue: 15000 });
    expect(uk).toEqual({ country: "UK", companies: 1, wonDeals: 1, revenue: 8000 });
    expect(oldland).toEqual({ country: "Oldland", companies: 1, wonDeals: 1, revenue: 999 });
  });

  it("computes byService exactly, joined via Company (LeadOpportunity has no direct Deal link)", async () => {
    const overview = await computeAcquisitionOverview(orgId);

    const webDev = overview.byService.find((s) => s.service === "Website Development");
    const seo = overview.byService.find((s) => s.service === "SEO");
    const crm = overview.byService.find((s) => s.service === "CRM");
    // Company A (2 Won deals, $15,000) and Company B (1 Won deal, $8,000) both
    // carry a WEBSITE_DEVELOPMENT-recommending LeadOpportunity, so their Won
    // deals are attributed to this service — 2 opportunities, 3 won deals total.
    expect(webDev).toEqual({ service: "Website Development", opportunities: 2, wonDeals: 3, revenue: 23000 });
    // Company C's LeadOpportunity recommends SEO, but Company C has no Won deal.
    expect(seo).toEqual({ service: "SEO", opportunities: 1, wonDeals: 0, revenue: 0 });
    expect(crm).toEqual({ service: "CRM", opportunities: 1, wonDeals: 1, revenue: 999 });
  });

  it("computes byCampaign exactly, including the documented multi-campaign Won-deal attribution", async () => {
    const overview = await computeAcquisitionOverview(orgId);

    const campaignX = overview.byCampaign.find((c) => c.campaignId === campaignXId);
    const campaignY = overview.byCampaign.find((c) => c.campaignId === campaignYId);

    // Campaign X: Contact A1 (Company A) + Contact C1 (Company C, no Won
    // deal). A1's EmailDraft(SENT)/Reply/OutreachMeeting(CONFIRMED) are
    // linked to X, plus C1's OutreachMeeting(COMPLETED) is also linked to X
    // (both are "real" meeting statuses; C1 has no EmailDraft/Reply linked
    // here). Won deals/revenue come only from Company A ($15,000 across its
    // 2 deals) — Company C has no Won deal at all.
    expect(campaignX).toEqual({
      campaignId: campaignXId,
      campaignName: "Campaign X",
      contactsEnrolled: 2,
      emailsSent: 1,
      replies: 1,
      meetings: 2,
      wonDeals: 2,
      revenue: 15000,
    });

    // Campaign Y: Contact A1 (Company A, ALSO enrolled in X) + Contact B1
    // (Company B). B1's EmailDraft(SENT)/Reply are linked to Y; B1's
    // OutreachMeeting is REQUESTED (not a "real" status), so meetings is 0.
    // wonDeals/revenue = Company A's 2 Won deals ($15,000) PLUS Company B's 1
    // Won deal ($8,000) = 3 deals / $23,000 — Company A's Won deals are
    // counted for BOTH Campaign X and Campaign Y since Contact A1 is a real,
    // independent CampaignContact enrollment in each. This is the same
    // honest multi-attribution limitation `byService` already documents for
    // a company whose LeadOpportunities recommend more than one service.
    expect(campaignY).toEqual({
      campaignId: campaignYId,
      campaignName: "Campaign Y",
      contactsEnrolled: 2,
      emailsSent: 1,
      replies: 1,
      meetings: 0,
      wonDeals: 3,
      revenue: 23000,
    });
  });

  it("a dateRange filter genuinely excludes out-of-range rows across every dimension", async () => {
    const from = new Date(Date.now() - 30 * DAY_MS);
    const to = new Date(Date.now() + DAY_MS);
    const overview = await computeAcquisitionOverview(orgId, { from, to });

    // The 400-day-old company/leadScore/opportunity/deal are all excluded —
    // only the 3 "recent" companies and their real funnel activity remain.
    expect(overview.funnel).toEqual([
      { stage: "Companies", count: 3 },
      { stage: "Qualified Leads", count: 2 },
      { stage: "Opportunities", count: 3 },
      { stage: "Contacts", count: 4 },
      { stage: "Outreach Sent", count: 2 },
      { stage: "Replies", count: 2 },
      { stage: "Meetings", count: 2 },
      { stage: "Proposals", count: 2 },
      { stage: "Won Deals", count: 3 },
    ]);
    expect(overview.totalRevenue).toBe(23000);

    const manual = overview.bySource.find((s) => s.source === "MANUAL");
    expect(manual).toEqual({ source: "MANUAL", companies: 0, qualifiedLeads: 0, opportunities: 0, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 });

    expect(overview.byIndustry.find((i) => i.industry === "Old Industry")).toBeUndefined();
    expect(overview.byCountry.find((c) => c.country === "Oldland")).toBeUndefined();
    expect(overview.byService.find((s) => s.service === "CRM")).toBeUndefined();

    // Every campaign-fixture row (CampaignContact.enrolledAt, EmailDraft.sentAt,
    // Reply.receivedAt, OutreachMeeting.createdAt, Deal.createdAt) is "now",
    // so a 30-day window includes all of it — byCampaign is unchanged from
    // the all-time result.
    expect(overview.byCampaign.find((c) => c.campaignId === campaignXId)).toEqual({
      campaignId: campaignXId,
      campaignName: "Campaign X",
      contactsEnrolled: 2,
      emailsSent: 1,
      replies: 1,
      meetings: 2,
      wonDeals: 2,
      revenue: 15000,
    });
    expect(overview.byCampaign.find((c) => c.campaignId === campaignYId)).toEqual({
      campaignId: campaignYId,
      campaignName: "Campaign Y",
      contactsEnrolled: 2,
      emailsSent: 1,
      replies: 1,
      meetings: 0,
      wonDeals: 3,
      revenue: 23000,
    });

    // A range that only covers the old company's era excludes everything recent.
    const oldFrom = new Date(Date.now() - 401 * DAY_MS);
    const oldTo = new Date(Date.now() - 399 * DAY_MS);
    const oldOnly = await computeAcquisitionOverview(orgId, { from: oldFrom, to: oldTo });
    expect(oldOnly.funnel.find((s) => s.stage === "Companies")?.count).toBe(1);
    expect(oldOnly.totalRevenue).toBe(999);
    // Both campaigns are still LISTED (never silently dropped, mirroring
    // bySource's fixed enumeration), but every per-campaign activity number
    // is zero since none of it falls in this old-only window. wonDeals/
    // revenue is also zero here because the only Won deal in this window
    // (the 400-day-old company's) has no campaign-enrolled contact at all.
    expect(oldOnly.byCampaign).toEqual(
      expect.arrayContaining([
        { campaignId: campaignXId, campaignName: "Campaign X", contactsEnrolled: 0, emailsSent: 0, replies: 0, meetings: 0, wonDeals: 0, revenue: 0 },
        { campaignId: campaignYId, campaignName: "Campaign Y", contactsEnrolled: 0, emailsSent: 0, replies: 0, meetings: 0, wonDeals: 0, revenue: 0 },
      ]),
    );
  });

  it("an org with zero data returns all-zero, never null/undefined/crash", async () => {
    const overview = await computeAcquisitionOverview(emptyOrgId);

    expect(overview.funnel).toEqual([
      { stage: "Companies", count: 0 },
      { stage: "Qualified Leads", count: 0 },
      { stage: "Opportunities", count: 0 },
      { stage: "Contacts", count: 0 },
      { stage: "Outreach Sent", count: 0 },
      { stage: "Replies", count: 0 },
      { stage: "Meetings", count: 0 },
      { stage: "Proposals", count: 0 },
      { stage: "Won Deals", count: 0 },
    ]);
    expect(overview.totalRevenue).toBe(0);
    expect(overview.bySource).toHaveLength(6);
    for (const s of overview.bySource) {
      expect(s.companies).toBe(0);
      expect(s.qualifiedLeads).toBe(0);
      expect(s.opportunities).toBe(0);
      expect(s.meetings).toBe(0);
      expect(s.proposals).toBe(0);
      expect(s.wonDeals).toBe(0);
      expect(s.revenue).toBe(0);
    }
    expect(overview.byIndustry).toEqual([]);
    expect(overview.byCountry).toEqual([]);
    expect(overview.byService).toEqual([]);
    // Zero real Campaigns in this org — an empty array, never a crash.
    expect(overview.byCampaign).toEqual([]);
  });

  it("companyAId/companyBId/companyCId/companyOldId fixtures resolve to real, distinct Company rows", async () => {
    const ids = [companyAId, companyBId, companyCId, companyOldId];
    expect(new Set(ids).size).toBe(4);
    const companies = await prisma.company.findMany({ where: { id: { in: ids } } });
    expect(companies).toHaveLength(4);
  });
});
