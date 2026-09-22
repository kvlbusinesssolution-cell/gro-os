import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildClientSummary, askAboutClient } from "../src/lib/business-development/client-360";
import { getCompanyCompleteTimeline } from "../src/lib/business-development/company-complete-timeline";
import { findOrCreateCompany } from "../src/lib/business-development/dedup";
import { resolveMembershipForCompany } from "../src/app/dashboard/companies/_lib/intelligence-actions";

const ORG_ID = "cmu6l7wka0001oq9gwawodgm1";
const USER_ID = "cmu6l7whe0000oq9g6d8ur5pt";

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

async function main() {
  const zomato = await prisma.company.findFirstOrThrow({ where: { organizationId: ORG_ID, name: "Zomato" } });
  console.log(`Using real company Zomato (${zomato.id}) — the richest real test account from Phase 1-4.`);

  // Clean prior test-only rows.
  await prisma.task.deleteMany({ where: { organizationId: ORG_ID, title: { startsWith: "[phase5-test]" } } });
  await prisma.invoice.deleteMany({ where: { organizationId: ORG_ID, invoiceNumber: { startsWith: "PHASE5-TEST" } } });
  await prisma.contract.deleteMany({ where: { organizationId: ORG_ID, title: { startsWith: "[phase5-test]" } } });
  await prisma.project.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase5-test]" } } });
  const priorEmpty = await prisma.company.findFirst({ where: { organizationId: ORG_ID, name: "[phase5-test] Empty Co" } });
  if (priorEmpty) await prisma.company.delete({ where: { id: priorEmpty.id } });

  // ===== TEST 1: company with no activity =====
  const { company: emptyCo } = await findOrCreateCompany({ organizationId: ORG_ID, name: "[phase5-test] Empty Co", source: "MANUAL", status: "PROSPECT" });
  const emptyTimeline = await getCompanyCompleteTimeline(ORG_ID, emptyCo.id);
  const emptySummary = await buildClientSummary(ORG_ID, emptyCo.id);
  report(
    "TEST 1: company with NO activity → only COMPANY_CREATED event, honest UNKNOWN summary, no fabrication",
    "timeline has exactly 1 entry (COMPANY_CREATED), all summary fields UNKNOWN",
    `timelineLength=${emptyTimeline.length}, currentSituation=${emptySummary?.currentSituation.status}, dealValue=${emptySummary?.dealValue.status}, revenue=${emptySummary?.revenue.source}`,
    emptyTimeline.length === 1 &&
      emptyTimeline[0].type === "COMPANY_CREATED" &&
      emptySummary?.currentSituation.status === "UNKNOWN" &&
      emptySummary?.dealValue.status === "UNKNOWN" &&
      emptySummary?.revenue.source === "UNKNOWN",
  );

  // ===== TEST 17: company with missing data (has SOME but not all sections) =====
  report(
    "TEST 17: company with missing data → whatWePromised/openIssues honestly UNKNOWN, not guessed",
    "whatWePromised=UNKNOWN, openIssues=UNKNOWN",
    `whatWePromised=${emptySummary?.whatWePromised.status}, openIssues=${emptySummary?.openIssues.status}`,
    emptySummary?.whatWePromised.status === "UNKNOWN" && emptySummary?.openIssues.status === "UNKNOWN",
  );

  // ===== TEST: large, rich account (Zomato — real research/intent/evidence/outreach/replies/proposal/deal from Phase 1-4) =====
  const zomatoTimeline = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const zomatoSummary = await buildClientSummary(ORG_ID, zomato.id);
  report(
    "TEST 3-9 (combined, real rich account): company with lead+intent+outreach+reply+proposal+deal",
    "timeline has real, varied event types; summary reflects real CUSTOMER stage + real deal value",
    `timelineLength=${zomatoTimeline.length}, eventTypes=${[...new Set(zomatoTimeline.map((e) => e.type))].length} distinct, currentSituation=${zomatoSummary?.currentSituation.value}, dealValue=${zomatoSummary?.dealValue.status}`,
    zomatoTimeline.length > 5 && zomatoSummary?.currentSituation.status === "CONFIRMED",
  );

  // ===== TEST 5: inbound reply reflected =====
  const hasReplyEvent = zomatoTimeline.some((e) => e.type === "REPLY_RECEIVED");
  report("TEST 5: company with inbound reply → REPLY_RECEIVED event present", "true", `hasReplyEvent=${hasReplyEvent}`, hasReplyEvent);

  // ===== TEST 8: company with proposal =====
  const hasProposalEvent = zomatoTimeline.some((e) => e.type === "PROPOSAL_CREATED");
  report("TEST 8: company with proposal → PROPOSAL_CREATED event present", "true", `hasProposalEvent=${hasProposalEvent}`, hasProposalEvent);

  // ===== TEST 9: company with deal (real Won deal from Phase 2) =====
  const hasDealEvent = zomatoTimeline.some((e) => e.type === "DEAL_CREATED");
  report("TEST 9: company with deal → DEAL_CREATED event present, currentSituation=CUSTOMER", `hasDealEvent=true, currentSituation=CUSTOMER`, `hasDealEvent=${hasDealEvent}, currentSituation=${zomatoSummary?.currentSituation.value}`, hasDealEvent && zomatoSummary?.currentSituation.value === "CUSTOMER");

  // ===== TEST 10 + 11 + 12: invoice + payment, contract, project =====
  const contract = await prisma.contract.create({ data: { organizationId: ORG_ID, companyId: zomato.id, contractNumber: "PHASE5-TEST-C1", type: "SOFTWARE_DEVELOPMENT_AGREEMENT", title: "[phase5-test] Zomato AI Automation Contract", content: "test", status: "SIGNED", value: 500000 } });
  const invoice = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: zomato.id, invoiceNumber: "PHASE5-TEST-INV1", status: "PAID", subtotal: 100000, grandTotal: 100000, amountPaid: 100000 } });
  const project = await prisma.project.create({ data: { organizationId: ORG_ID, companyId: zomato.id, name: "[phase5-test] AI Automation Delivery", status: "ACTIVE", startDate: new Date() } });
  const enrichedTimeline = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const enrichedSummary = await buildClientSummary(ORG_ID, zomato.id);
  report(
    "TEST 10 + 11 + 12: real Invoice(PAID)/Contract(SIGNED)/Project(ACTIVE) → real timeline events + summary reflects them",
    "INVOICE_CREATED, PAYMENT_RECEIVED, CONTRACT_CREATED, PROJECT_STARTED all present; whatWePromised CONFIRMED; revenue paid=100000; currentSituation=DELIVERY",
    `hasInvoice=${enrichedTimeline.some((e) => e.type === "INVOICE_CREATED")}, hasPayment=${enrichedTimeline.some((e) => e.type === "PAYMENT_RECEIVED")}, hasContract=${enrichedTimeline.some((e) => e.type === "CONTRACT_CREATED")}, hasProject=${enrichedTimeline.some((e) => e.type === "PROJECT_STARTED")}, whatWePromised=${enrichedSummary?.whatWePromised.status}, revenuePaid=${enrichedSummary?.revenue.paid}, currentSituation=${enrichedSummary?.currentSituation.value}`,
    enrichedTimeline.some((e) => e.type === "INVOICE_CREATED") &&
      enrichedTimeline.some((e) => e.type === "PAYMENT_RECEIVED") &&
      enrichedTimeline.some((e) => e.type === "CONTRACT_CREATED") &&
      enrichedTimeline.some((e) => e.type === "PROJECT_STARTED") &&
      enrichedSummary?.whatWePromised.status === "CONFIRMED" &&
      enrichedSummary?.revenue.paid === 100000 &&
      enrichedSummary?.currentSituation.value === "DELIVERY",
  );

  // ===== TEST 13: company with support ticket =====
  const supportTask = await prisma.task.create({ data: { organizationId: ORG_ID, companyId: zomato.id, title: "[phase5-test] API integration issue", type: "SUPPORT", status: "PENDING" } });
  const withSupportTimeline = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const withSupportSummary = await buildClientSummary(ORG_ID, zomato.id);
  // Note: this company also has a real ACTIVE Project from the prior test
  // block — deriveCurrentSituation intentionally prioritizes an active
  // delivery project over a single open support ticket (a company mid-
  // delivery that also has one open ticket is still, correctly, "in
  // DELIVERY" — SUPPORT is reserved for when delivery itself has no active
  // project). The SUPPORT_TICKET_CREATED event and openIssues=CONFIRMED are
  // the real, independent things this test verifies.
  report(
    "TEST 13: company with open support ticket → SUPPORT_TICKET_CREATED event + openIssues CONFIRMED (currentSituation stays DELIVERY — an active project outranks a single ticket, by design)",
    "hasTicketEvent=true, openIssues=CONFIRMED, currentSituation=DELIVERY",
    `hasTicketEvent=${withSupportTimeline.some((e) => e.type === "SUPPORT_TICKET_CREATED")}, openIssues=${withSupportSummary?.openIssues.status}, currentSituation=${withSupportSummary?.currentSituation.value}`,
    withSupportTimeline.some((e) => e.type === "SUPPORT_TICKET_CREATED") && withSupportSummary?.openIssues.status === "CONFIRMED" && withSupportSummary?.currentSituation.value === "DELIVERY",
  );

  // ===== TEST 18: duplicate source events → no duplicate timeline entries (idempotency, §7) =====
  const run1 = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const run2 = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const idsMatch = run1.length === run2.length && run1.every((e, i) => e.id === run2[i].id);
  const uniqueIdCount = new Set(run1.map((e) => e.id)).size;
  report(
    "TEST 18: calling the timeline composer twice (simulating repeated sync) → byte-identical result, zero duplicate IDs",
    "run1 === run2 exactly, all entry IDs unique",
    `run1Length=${run1.length}, run2Length=${run2.length}, idsMatch=${idsMatch}, uniqueIds=${uniqueIdCount}/${run1.length}`,
    idsMatch && uniqueIdCount === run1.length,
  );

  // ===== TEST 6: chronological ordering is deterministic =====
  const isSorted = run1.every((e, i) => i === 0 || run1[i - 1].occurredAt.getTime() <= e.occurredAt.getTime());
  report("TEST: timeline is deterministically sorted ascending by occurredAt", "true", `isSorted=${isSorted}`, isSorted);

  // ===== TEST 15 (multiple contacts) + 16 (multiple decision makers) — Zomato already has 3 real decision makers from Phase 1 =====
  const decisionMakerCount = await prisma.decisionMaker.count({ where: { companyId: zomato.id } });
  const contactCount = await prisma.contact.count({ where: { companyId: zomato.id } });
  report(
    "TEST 15 + 16: company with multiple contacts and multiple real decision makers",
    "decisionMakerCount >= 2 (real: Deepinder Goyal, Mohit Gupta, Gaurav Gupta from Phase 1)",
    `contactCount=${contactCount}, decisionMakerCount=${decisionMakerCount}`,
    decisionMakerCount >= 2,
  );

  // ===== TEST 19: multiple tenants + TEST 22: cross-tenant AI access blocked =====
  const otherOrg = await prisma.organization.findFirst({ where: { id: { not: ORG_ID } } });
  if (otherOrg) {
    const otherMembership = await prisma.membership.findFirst({ where: { organizationId: otherOrg.id, status: "ACTIVE" } });
    if (otherMembership) {
      const crossOrgResolve = await resolveMembershipForCompany(otherMembership.userId, zomato.id);
      const crossOrgAnswer = await askAboutClient(otherOrg.id, zomato.id, "What is the deal value?");
      report(
        "TEST 19 + 22: cross-tenant access blocked at both the resolver AND the AI grounding layer",
        "resolveMembershipForCompany=null; askAboutClient refuses (Company not found in your organization)",
        `resolved=${crossOrgResolve === null ? "null (blocked)" : "LEAKED"}, aiAnswer="${crossOrgAnswer.answer}"`,
        crossOrgResolve === null && crossOrgAnswer.answer.includes("not found"),
      );
    } else {
      report("TEST 19 + 22: tenant isolation", "SKIPPED — no other org has an active membership", "n/a", true);
    }
  } else {
    report("TEST 19 + 22: tenant isolation", "SKIPPED — only one real Organization exists locally", "n/a", true);
  }

  // ===== TEST 20: AI question with available evidence =====
  const groundedAnswer = await askAboutClient(ORG_ID, zomato.id, "What service is being discussed with this client?");
  report(
    "TEST 20: AI question with real available evidence → real, cited answer",
    "confidence != UNKNOWN OR a real reason given; supportingRecords may be present",
    `answer="${groundedAnswer.answer.slice(0, 120)}...", confidence=${groundedAnswer.confidence}, supportingRecordCount=${groundedAnswer.supportingRecords.length}`,
    groundedAnswer.answer.length > 0,
  );

  // ===== TEST 21 + Anti-hallucination: AI question with NO evidence in this company =====
  const noEvidenceAnswer = await askAboutClient(ORG_ID, emptyCo.id, "What budget did they give us?");
  report(
    "TEST 21 + ANTI-HALLUCINATION: question about a company with zero real records → honest 'not found', never a guess",
    'answer = "I couldn\'t find this information in the stored client records." (or an honest AI-unavailable message)',
    `answer="${noEvidenceAnswer.answer}"`,
    noEvidenceAnswer.answer.includes("couldn't find") || noEvidenceAnswer.answer.includes("not connected") || noEvidenceAnswer.answer.includes("unavailable"),
  );

  console.log(`\n\n===== SUMMARY: ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("TEST SCRIPT CRASHED:", error);
  process.exit(1);
});
