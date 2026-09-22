import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  computeAttributionForInvoice,
  computeAttributionForOrganization,
  getAttributionChainForInvoice,
  getAttributionOverview,
  getFinancialConsistencyCheck,
  getRevenueBySource,
  getRevenueByCampaign,
  getRevenueByAiCampaign,
  getAttributionDataQualityReport,
  type EvidenceLink,
  type Touchpoint,
} from "../src/lib/analytics/revenue-attribution";

const ORG_ID = "cmu6l7wka0001oq9gwawodgm1"; // real E2E Fixture Org
const USER_ID = "cmu6l7whe0000oq9g6d8ur5pt"; // real e2e-fixture user
const OTHER_ORG_ID = "cmu6l7wka0001oq9gwawodgm1-does-not-exist"; // deliberately invalid org for cross-tenant test

let pass = 0;
let fail = 0;
function report(test: string, expected: string, actual: string, passed: boolean) {
  console.log(`\n--- ${test} ---`);
  console.log(`EXPECTED: ${expected}`);
  console.log(`ACTUAL:   ${actual}`);
  console.log(passed ? "PASS" : "FAIL");
  if (passed) pass += 1;
  else fail += 1;
}

async function makeContact(companyId: string, email: string, firstName: string) {
  return prisma.contact.create({ data: { organizationId: ORG_ID, companyId, firstName, email } });
}

async function main() {
  const wonStage = await prisma.dealStage.findFirstOrThrow({ where: { name: "Won" } });

  // Clean up any leftovers from a prior run.
  await prisma.revenueAttribution.deleteMany({ where: { organizationId: ORG_ID, company: { name: { startsWith: "[phase7-test]" } } } });
  await prisma.invoice.deleteMany({ where: { organizationId: ORG_ID, company: { name: { startsWith: "[phase7-test]" } } } });
  await prisma.deal.deleteMany({ where: { organizationId: ORG_ID, company: { name: { startsWith: "[phase7-test]" } } } });
  await prisma.outreachMeeting.deleteMany({ where: { organizationId: ORG_ID, contact: { company: { name: { startsWith: "[phase7-test]" } } } } });
  await prisma.reply.deleteMany({ where: { organizationId: ORG_ID, contact: { company: { name: { startsWith: "[phase7-test]" } } } } });
  await prisma.emailDraft.deleteMany({ where: { organizationId: ORG_ID, contact: { company: { name: { startsWith: "[phase7-test]" } } } } });
  await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, company: { name: { startsWith: "[phase7-test]" } } } });
  await prisma.campaign.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase7-test]" } } });
  await prisma.company.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase7-test]" } } });

  // ===================================================================
  // SCENARIO 1: clean direct path — Campaign -> Company -> Contact ->
  // Email -> Reply -> Meeting -> Deal -> Invoice -> Revenue.
  // ===================================================================
  const campaign1 = await prisma.campaign.create({
    data: { organizationId: ORG_ID, name: "[phase7-test] Clean Path Campaign", type: "STANDARD", approvalMode: "AUTOMATIC", createdByUserId: USER_ID },
  });
  const co1 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] CleanPath Co", source: "MANUAL" } });
  const contact1 = await makeContact(co1.id, "phase7-clean@example-test.invalid", "Clean");
  const draft1 = await prisma.emailDraft.create({
    data: { organizationId: ORG_ID, contactId: contact1.id, campaignId: campaign1.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: "[phase7-test]", body: "test", status: "SENT", sentAt: new Date() },
  });
  await prisma.reply.create({
    data: { organizationId: ORG_ID, contactId: contact1.id, campaignId: campaign1.id, emailDraftId: draft1.id, channel: "EMAIL", content: "[phase7-test] Interested, let's talk.", receivedAt: new Date(), loggedByUserId: USER_ID },
  });
  await prisma.outreachMeeting.create({ data: { organizationId: ORG_ID, contactId: contact1.id, campaignId: campaign1.id, emailDraftId: draft1.id, title: "[phase7-test] intro call", status: "COMPLETED" } });
  const deal1 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co1.id, contactId: contact1.id, name: "[phase7-test] Clean Deal", value: 200000, services: ["WEBSITE_DEVELOPMENT"] } });
  const invoice1 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co1.id, dealId: deal1.id, invoiceNumber: "PHASE7-TEST-INV1", status: "PAID", subtotal: 200000, grandTotal: 200000, amountPaid: 200000, paidAt: new Date() } });

  // A second, unrelated real campaign this contact was merely ENROLLED in
  // (audience membership only, never sent/replied) — must get zero credit.
  const decoyCampaign = await prisma.campaign.create({ data: { organizationId: ORG_ID, name: "[phase7-test] Decoy Enrollment-Only Campaign", type: "STANDARD", createdByUserId: USER_ID } });
  await prisma.campaignContact.create({ data: { campaignId: decoyCampaign.id, contactId: contact1.id } });

  const attr1 = await computeAttributionForInvoice(ORG_ID, invoice1.id);
  report(
    "SCENARIO 1: clean Campaign->Email->Reply->Meeting->Deal->Invoice path",
    "DIRECT, campaignId = campaign1, revenueAmount = 200000",
    `type=${attr1?.attributionType}, campaignId=${attr1?.campaignId}, revenue=${attr1?.revenueAmount}, rule=${attr1?.attributionRule}`,
    attr1?.attributionType === "DIRECT" && attr1?.campaignId === campaign1.id && attr1?.revenueAmount === 200000,
  );

  // ===================================================================
  // SCENARIO 2: no campaign, no non-MANUAL source, but a real deal+paid
  // invoice exists -> UNKNOWN, never guessed.
  // ===================================================================
  const co2 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] NoSource Co", source: "MANUAL" } });
  const contact2 = await makeContact(co2.id, "phase7-nosource@example-test.invalid", "NoSource");
  const deal2 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co2.id, contactId: contact2.id, name: "[phase7-test] NoSource Deal", value: 50000 } });
  const invoice2 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co2.id, dealId: deal2.id, invoiceNumber: "PHASE7-TEST-INV2", status: "PAID", subtotal: 50000, grandTotal: 50000, amountPaid: 50000, paidAt: new Date() } });
  const attr2 = await computeAttributionForInvoice(ORG_ID, invoice2.id);
  report(
    "SCENARIO 2 (§8/§50): no campaign engagement, MANUAL source -> UNKNOWN, never forced into a campaign",
    "UNKNOWN, no campaignId",
    `type=${attr2?.attributionType}, campaignId=${attr2?.campaignId}, source=${attr2?.source}`,
    attr2?.attributionType === "UNKNOWN" && attr2?.campaignId === null,
  );

  // ===================================================================
  // SCENARIO 3: real non-MANUAL source only (REFERRAL), no campaign ->
  // DIRECT attribution to the source, no campaignId.
  // ===================================================================
  const co3 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] ReferralOnly Co", source: "REFERRAL" } });
  const contact3 = await makeContact(co3.id, "phase7-referral@example-test.invalid", "Referral");
  const deal3 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co3.id, contactId: contact3.id, name: "[phase7-test] Referral Deal", value: 75000 } });
  const invoice3 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co3.id, dealId: deal3.id, invoiceNumber: "PHASE7-TEST-INV3", status: "PAID", subtotal: 75000, grandTotal: 75000, amountPaid: 75000, paidAt: new Date() } });
  const attr3 = await computeAttributionForInvoice(ORG_ID, invoice3.id);
  report(
    "SCENARIO 3: single real non-MANUAL source (REFERRAL), no campaign -> DIRECT to the source",
    "DIRECT, campaignId=null, source=REFERRAL",
    `type=${attr3?.attributionType}, campaignId=${attr3?.campaignId}, source=${attr3?.source}, rule=${attr3?.attributionRule}`,
    attr3?.attributionType === "DIRECT" && attr3?.campaignId === null && attr3?.source === "REFERRAL",
  );

  // ===================================================================
  // SCENARIO 4 (§7/§42): TWO real touchpoints — a real non-MANUAL source
  // AND a real engaged campaign -> ASSISTED, no arbitrary winner.
  // ===================================================================
  const campaign4 = await prisma.campaign.create({ data: { organizationId: ORG_ID, name: "[phase7-test] MultiTouch Campaign", type: "STANDARD", createdByUserId: USER_ID } });
  const co4 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] MultiTouch Co", source: "WEBSITE_SCANNER" } });
  const contact4 = await makeContact(co4.id, "phase7-multitouch@example-test.invalid", "MultiTouch");
  const draft4 = await prisma.emailDraft.create({ data: { organizationId: ORG_ID, contactId: contact4.id, campaignId: campaign4.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: "[phase7-test]", body: "test", status: "SENT", sentAt: new Date() } });
  await prisma.reply.create({ data: { organizationId: ORG_ID, contactId: contact4.id, campaignId: campaign4.id, emailDraftId: draft4.id, channel: "EMAIL", content: "[phase7-test] reply", receivedAt: new Date(), loggedByUserId: USER_ID } });
  const deal4 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co4.id, contactId: contact4.id, name: "[phase7-test] MultiTouch Deal", value: 90000 } });
  const invoice4 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co4.id, dealId: deal4.id, invoiceNumber: "PHASE7-TEST-INV4", status: "PAID", subtotal: 90000, grandTotal: 90000, amountPaid: 90000, paidAt: new Date() } });
  const attr4 = await computeAttributionForInvoice(ORG_ID, invoice4.id);
  const touchpoints4 = (attr4?.touchpoints ?? []) as unknown as Touchpoint[];
  report(
    "SCENARIO 4 (§7/§42): real source + real engaged campaign both proven -> ASSISTED, both touchpoints recorded, no winner picked",
    "ASSISTED, 2 touchpoints (1 CAMPAIGN + 1 SOURCE), campaignId=null on the row itself",
    `type=${attr4?.attributionType}, touchpointCount=${touchpoints4.length}, types=${touchpoints4.map((t) => t.type).join(",")}, campaignId=${attr4?.campaignId}`,
    attr4?.attributionType === "ASSISTED" && touchpoints4.length === 2 && attr4?.campaignId === null,
  );

  // ===================================================================
  // SCENARIO 5 (§50): unpaid invoice -> no attribution row at all.
  // ===================================================================
  const co5 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] Pending Co", source: "MANUAL" } });
  const invoice5 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co5.id, invoiceNumber: "PHASE7-TEST-INV5", status: "SENT", subtotal: 40000, grandTotal: 40000, amountPaid: 0 } });
  const attr5 = await computeAttributionForInvoice(ORG_ID, invoice5.id);
  report(
    "SCENARIO 5 (§24/§50): invoice exists but payment pending (amountPaid=0) -> no attribution row created",
    "null (not counted as paid revenue)",
    `attr5=${attr5}`,
    attr5 === null,
  );

  // ===================================================================
  // SCENARIO 6 (§17/§50): a DRAFT (never-sent) email must never count as
  // outreach/a touchpoint.
  // ===================================================================
  const campaign6 = await prisma.campaign.create({ data: { organizationId: ORG_ID, name: "[phase7-test] Draft-Only Campaign", type: "STANDARD", createdByUserId: USER_ID } });
  const co6 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] DraftOnly Co", source: "MANUAL" } });
  const contact6 = await makeContact(co6.id, "phase7-draftonly@example-test.invalid", "DraftOnly");
  await prisma.emailDraft.create({ data: { organizationId: ORG_ID, contactId: contact6.id, campaignId: campaign6.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: "[phase7-test] never sent", body: "test", status: "DRAFT" } });
  const deal6 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co6.id, contactId: contact6.id, name: "[phase7-test] DraftOnly Deal", value: 30000 } });
  const invoice6 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co6.id, dealId: deal6.id, invoiceNumber: "PHASE7-TEST-INV6", status: "PAID", subtotal: 30000, grandTotal: 30000, amountPaid: 30000, paidAt: new Date() } });
  const attr6 = await computeAttributionForInvoice(ORG_ID, invoice6.id);
  report(
    "SCENARIO 6 (§17/§50): a never-sent DRAFT email is never counted as outreach -> UNKNOWN (no proven touchpoint)",
    "UNKNOWN, campaignId=null",
    `type=${attr6?.attributionType}, campaignId=${attr6?.campaignId}`,
    attr6?.attributionType === "UNKNOWN" && attr6?.campaignId === null,
  );

  // ===================================================================
  // SCENARIO 7 (§50): SENT email but no reply ever -> not a proven
  // engaged campaign either.
  // ===================================================================
  const campaign7 = await prisma.campaign.create({ data: { organizationId: ORG_ID, name: "[phase7-test] SentNoReply Campaign", type: "STANDARD", createdByUserId: USER_ID } });
  const co7 = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase7-test] SentNoReply Co", source: "MANUAL" } });
  const contact7 = await makeContact(co7.id, "phase7-sentnoreply@example-test.invalid", "SentNoReply");
  await prisma.emailDraft.create({ data: { organizationId: ORG_ID, contactId: contact7.id, campaignId: campaign7.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: "[phase7-test] sent, no reply", body: "test", status: "SENT", sentAt: new Date() } });
  const deal7 = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: co7.id, contactId: contact7.id, name: "[phase7-test] SentNoReply Deal", value: 60000 } });
  const invoice7 = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: co7.id, dealId: deal7.id, invoiceNumber: "PHASE7-TEST-INV7", status: "PAID", subtotal: 60000, grandTotal: 60000, amountPaid: 60000, paidAt: new Date() } });
  const attr7 = await computeAttributionForInvoice(ORG_ID, invoice7.id);
  report(
    "SCENARIO 7 (§18/§50): SENT email with no real Reply -> not proven engagement -> UNKNOWN",
    "UNKNOWN",
    `type=${attr7?.attributionType}`,
    attr7?.attributionType === "UNKNOWN",
  );

  // ===================================================================
  // SCENARIO 8 (§44): fully orphan paid invoice (no deal, no company, no client).
  // ===================================================================
  const invoice8 = await prisma.invoice.create({ data: { organizationId: ORG_ID, invoiceNumber: "PHASE7-TEST-INV8", status: "PAID", subtotal: 15000, grandTotal: 15000, amountPaid: 15000, paidAt: new Date() } });
  const attr8 = await computeAttributionForInvoice(ORG_ID, invoice8.id);
  const dq = await getAttributionDataQualityReport(ORG_ID);
  report(
    "SCENARIO 8 (§44): fully orphan paid invoice (no dealId/companyId/clientId) -> UNKNOWN, flagged as a data-quality orphan",
    "UNKNOWN, orphanInvoicesNoCompany >= 1",
    `type=${attr8?.attributionType}, orphanInvoicesNoCompany=${dq.orphanInvoicesNoCompany}`,
    attr8?.attributionType === "UNKNOWN" && dq.orphanInvoicesNoCompany >= 1,
  );

  // ===================================================================
  // SCENARIO 9 (§45 idempotency): recomputing the same invoice never
  // creates a duplicate row.
  // ===================================================================
  const beforeCount = await prisma.revenueAttribution.count({ where: { organizationId: ORG_ID, invoiceId: invoice1.id } });
  const recomputed = await computeAttributionForInvoice(ORG_ID, invoice1.id);
  const afterCount = await prisma.revenueAttribution.count({ where: { organizationId: ORG_ID, invoiceId: invoice1.id } });
  report(
    "SCENARIO 9 (§45): recomputing the same invoice is idempotent — upsert, never a duplicate row",
    "count unchanged (1), same row id",
    `beforeCount=${beforeCount}, afterCount=${afterCount}, sameId=${recomputed?.id === attr1?.id}`,
    beforeCount === 1 && afterCount === 1 && recomputed?.id === attr1?.id,
  );

  // ===================================================================
  // SCENARIO 10 (§46 cross-tenant): a wrong organizationId can never read
  // another org's real invoice attribution.
  // ===================================================================
  const crossTenantResult = await computeAttributionForInvoice(OTHER_ORG_ID, invoice1.id);
  const crossTenantChain = await getAttributionChainForInvoice(OTHER_ORG_ID, invoice1.id);
  report(
    "SCENARIO 10 (§46): cross-tenant access — wrong organizationId against a real invoice -> null, never leaks another org's data",
    "both null",
    `computeResult=${crossTenantResult}, chainResult=${crossTenantChain}`,
    crossTenantResult === null && crossTenantChain === null,
  );

  // ===================================================================
  // SCENARIO 11 (§13): mere campaign-audience enrollment never earns
  // credit — the decoy campaign from Scenario 1 must not appear.
  // ===================================================================
  const byCampaign = await getRevenueByCampaign(ORG_ID);
  const decoyAppears = byCampaign.some((c) => c.campaignId === decoyCampaign.id);
  const realCampaignAppears = byCampaign.some((c) => c.campaignId === campaign1.id && c.direct >= 1);
  report(
    "SCENARIO 11 (§13): audience-enrollment-only campaign gets zero credit; the genuinely engaged campaign does appear",
    "decoyAppears=false, realCampaignAppears=true",
    `decoyAppears=${decoyAppears}, realCampaignAppears=${realCampaignAppears}`,
    !decoyAppears && realCampaignAppears,
  );

  // ===================================================================
  // SCENARIO 12: AI campaign dimension (approvalMode AUTOMATIC).
  // ===================================================================
  const byAiCampaign = await getRevenueByAiCampaign(ORG_ID);
  const aiCampaignAppears = byAiCampaign.some((c) => c.campaignId === campaign1.id);
  const nonAiCampaignAppears = byAiCampaign.some((c) => c.campaignId === campaign4.id);
  report(
    "SCENARIO 12 (§34): Revenue by AI Campaign includes only campaigns with approvalMode AUTOMATIC",
    "campaign1 (AUTOMATIC) appears, campaign4 (MANUAL default) does not",
    `campaign1Appears=${aiCampaignAppears}, campaign4Appears=${nonAiCampaignAppears}`,
    aiCampaignAppears && !nonAiCampaignAppears,
  );

  // ===================================================================
  // SCENARIO 13: Revenue by Source excludes MANUAL-only companies from
  // real source credit (co1/co2/co6/co7 are all MANUAL).
  // ===================================================================
  const bySource = await getRevenueBySource(ORG_ID);
  const referralRow = bySource.find((r) => r.source === "REFERRAL");
  report(
    "SCENARIO 13: Revenue by Source real REFERRAL bucket includes co3's real ₹75,000",
    "REFERRAL revenue >= 75000",
    `referralRevenue=${referralRow?.revenue}`,
    (referralRow?.revenue ?? 0) >= 75000,
  );

  // ===================================================================
  // SCENARIO 14: evidence chain anti-hallucination — every DIRECT_FK
  // recordId in scenario 1's chain is a real, existing row.
  // ===================================================================
  const chain1 = await getAttributionChainForInvoice(ORG_ID, invoice1.id);
  const evidence1 = (chain1?.evidence ?? []) as unknown as EvidenceLink[];
  const directFkLinks = evidence1.filter((e) => e.proofType === "DIRECT_FK");
  let allRealChecks = true;
  for (const link of directFkLinks) {
    let exists = false;
    if (link.recordType === "Company") exists = !!(await prisma.company.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "Deal") exists = !!(await prisma.deal.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "Invoice") exists = !!(await prisma.invoice.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "EmailDraft") exists = !!(await prisma.emailDraft.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "Reply") exists = !!(await prisma.reply.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "Contact") exists = !!(await prisma.contact.findUnique({ where: { id: link.recordId } }));
    else if (link.recordType === "OutreachMeeting") exists = !!(await prisma.outreachMeeting.findUnique({ where: { id: link.recordId } }));
    else exists = true; // not spot-checked
    if (!exists) allRealChecks = false;
  }
  report(
    "SCENARIO 14 (§42 anti-hallucination): every DIRECT_FK evidence link in the chain resolves to a real, existing row",
    "true — no fabricated record ids",
    `directFkLinkCount=${directFkLinks.length}, allRealChecks=${allRealChecks}`,
    directFkLinks.length > 0 && allRealChecks,
  );

  // ===================================================================
  // SCENARIO 15 (§51 financial consistency): after a full org recompute,
  // Direct + Assisted + Unknown must sum exactly to real total paid
  // revenue — never double-counted.
  // ===================================================================
  await computeAttributionForOrganization(ORG_ID);
  const consistency = await getFinancialConsistencyCheck(ORG_ID);
  report(
    "SCENARIO 15 (§51): Direct+Assisted+Unknown sums exactly to real total paid revenue after a full recompute — no double counting",
    "consistent=true, gap≈0",
    `totalPaid=${consistency.totalPaidRevenue}, totalAttributed=${consistency.totalAttributedRevenue}, gap=${consistency.gap}, consistent=${consistency.consistent}`,
    consistency.consistent,
  );

  // ===================================================================
  // SCENARIO 16: Attribution Overview tile math matches the raw rows.
  // ===================================================================
  const overview = await getAttributionOverview(ORG_ID);
  report(
    "SCENARIO 16: Attribution Overview direct+assisted+unknown counts sum to attributedInvoiceCount",
    `${overview.attributedInvoiceCount}`,
    `${overview.directCount + overview.assistedCount + overview.unknownCount}`,
    overview.directCount + overview.assistedCount + overview.unknownCount === overview.attributedInvoiceCount,
  );

  console.log(`\n\n===== PHASE 7 RESULTS: ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
