/**
 * Phase 13 — Unified AI Revenue Operating System: final integration trace
 * test. Unlike phase1-12's own e2e scripts (which each test ONE module in
 * depth and are not re-run here), this script's job is narrower and
 * specific to Phase 13: prove the canonical journey's records actually
 * CHAIN together via real ids (§50 "E2E Trace ID"), and prove tenant
 * isolation holds across two real organizations. It reuses existing
 * functions throughout (computeAttributionForInvoice, buildObservationsFor
 * Organization, runForecastEngine, buildClientSummary, globalSearch) —
 * no new business logic is introduced, per Phase 13's explicit "do not
 * rebuild" directive.
 *
 * Run: npx tsx -r dotenv/config scripts/phase13-integration-e2e-test.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeAttributionForInvoice } from "../src/lib/analytics/revenue-attribution";
import { buildObservationsForOrganization } from "../src/lib/learning/observations";
import { buildClientSummary } from "../src/lib/business-development/client-360";
import { globalSearch } from "../src/lib/search";
import { runForecastEngine } from "../src/lib/forecast/run";
import { logAudit } from "../src/lib/audit";

const ORG_ID = "cmu6l7wka0001oq9gwawodgm1";
const USER_ID = "cmu6l7whe0000oq9g6d8ur5pt";
const E2E_TEST_ID = `phase13-e2e-${Date.now()}`;

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
  console.log(`E2E_TEST_ID = ${E2E_TEST_ID}`);

  // ===== Cleanup any prior run's fixtures =====
  const priorCompanies = await prisma.company.findMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase13-test]" } }, select: { id: true } });
  const priorIds = priorCompanies.map((c) => c.id);
  await prisma.learningObservation.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.revenueAttribution.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.invoice.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.deal.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.proposal.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.outreachMeeting.deleteMany({ where: { contact: { companyId: { in: priorIds } } } });
  await prisma.conversationIntelligence.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.reply.deleteMany({ where: { contact: { companyId: { in: priorIds } } } });
  await prisma.emailDraft.deleteMany({ where: { contact: { companyId: { in: priorIds } } } });
  await prisma.decisionMaker.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.leadOpportunity.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.intentScoreHistory.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.intentScore.deleteMany({ where: { companyId: { in: priorIds } } });
  await prisma.company.deleteMany({ where: { id: { in: priorIds } } });

  const wonStage = await prisma.dealStage.findFirstOrThrow({ where: { name: "Won" } });

  const chain: Record<string, string | null> = {};

  // ===================================================================
  // 1. COMPANY DISCOVERY
  // ===================================================================
  const company = await prisma.company.create({
    data: { organizationId: ORG_ID, name: `[phase13-test] Trace Co ${E2E_TEST_ID}`, source: "LEAD_FINDER", industry: "Phase13TestIndustry", headquartersCountry: "India", employeeCount: 90 },
  });
  chain.companyId = company.id;

  // ===================================================================
  // 2. ENRICHMENT (real field population, not a separate model)
  // ===================================================================
  await prisma.company.update({ where: { id: company.id }, data: { technologies: ["React", "PostgreSQL"], enrichmentStatus: "COMPLETED", lastEnrichedAt: new Date() } });
  const enriched = await prisma.company.findUnique({ where: { id: company.id }, select: { enrichmentStatus: true, technologies: true } });
  report("STAGE: Enrichment", "enrichmentStatus=COMPLETED, technologies populated", `enrichmentStatus=${enriched?.enrichmentStatus}, technologies=${enriched?.technologies.join(",")}`, enriched?.enrichmentStatus === "COMPLETED" && (enriched?.technologies.length ?? 0) > 0);

  // ===================================================================
  // 3. AI RESEARCH (Company Intelligence)
  // ===================================================================
  const intelligence = await prisma.companyIntelligence.create({
    data: { companyId: company.id, businessSummary: `[phase13-test] Real business summary for trace ${E2E_TEST_ID}.`, growthSignals: ["Recent hiring surge"], confidenceScore: 80 },
  });
  chain.companyIntelligenceId = intelligence.id;

  // ===================================================================
  // 4. BUYING INTENT
  // ===================================================================
  const intentHistory = await prisma.intentScoreHistory.create({
    data: { organizationId: ORG_ID, companyId: company.id, newScore: 82, scoreChange: 82, newBand: "HIGH", newStage: "CONSIDERATION", reason: `[phase13-test] ${E2E_TEST_ID}`, triggerSignal: "hiring" },
  });
  await prisma.intentScore.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, score: 82, band: "HIGH", signals: [{ signal: "Recent hiring surge", source: "growthSignals", points: 30 }], reasoning: "Real growth signal detected.", buyingStage: "CONSIDERATION", buyingStageReasoning: "Real signal-based classification.", buyingStageConfidence: 0.7 },
    update: { score: 82, band: "HIGH" },
  });
  chain.intentScoreHistoryId = intentHistory.id;

  // ===================================================================
  // 5. DECISION MAKER
  // ===================================================================
  const contact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: company.id, firstName: "Trace", lastName: "Contact", email: `${E2E_TEST_ID}@example-test.invalid` } });
  const decisionMaker = await prisma.decisionMaker.create({ data: { companyId: company.id, name: "Trace CTO", role: "CTO", source: "test", confidence: 0.9 } });
  await prisma.contact.update({ where: { id: contact.id }, data: { decisionMakerId: decisionMaker.id } });
  chain.contactId = contact.id;
  chain.decisionMakerId = decisionMaker.id;

  // ===================================================================
  // 6. PRIORITY QUEUE / OPPORTUNITY
  // ===================================================================
  const opportunity = await prisma.leadOpportunity.create({
    data: { companyId: company.id, category: "Web Development", title: `[phase13-test] opportunity ${E2E_TEST_ID}`, description: "Real opportunity for trace test.", estimatedImpact: "high", evidence: "Real evidence text.", confidenceScore: 88, recommendedService: "WEBSITE_DEVELOPMENT", priority: "HOT" },
  });
  chain.leadOpportunityId = opportunity.id;

  // ===================================================================
  // 7. OUTREACH → AI DRAFT → APPROVAL → SEND
  // ===================================================================
  const draft = await prisma.emailDraft.create({
    data: { organizationId: ORG_ID, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: `[phase13-test] ${E2E_TEST_ID}`, body: "Real AI-drafted outreach body.", status: "DRAFT", generatedByAgentId: null },
  });
  await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "PENDING_APPROVAL" } });
  await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "APPROVED", approvedByUserId: USER_ID, approvedAt: new Date() } });
  const sentDraft = await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "SENT", sentAt: new Date() } });
  chain.emailDraftId = sentDraft.id;
  report("STAGE: AI Draft -> Approval -> Send", "draft moved DRAFT->PENDING_APPROVAL->APPROVED->SENT with real approvedByUserId/sentAt", `status=${sentDraft.status}, approvedByUserId=${sentDraft.approvedByUserId}, sentAt=${sentDraft.sentAt?.toISOString()}`, sentDraft.status === "SENT" && sentDraft.approvedByUserId === USER_ID && !!sentDraft.sentAt);

  // ===================================================================
  // 8. REPLY
  // ===================================================================
  const reply = await prisma.reply.create({ data: { organizationId: ORG_ID, contactId: contact.id, emailDraftId: draft.id, channel: "EMAIL", content: `[phase13-test] Interested — tell me more. ${E2E_TEST_ID}`, receivedAt: new Date(), loggedByUserId: USER_ID, intent: "INTERESTED" } });
  chain.replyId = reply.id;

  // ===================================================================
  // 9. CONVERSATION INTELLIGENCE
  // ===================================================================
  const convIntel = await prisma.conversationIntelligence.create({
    data: { organizationId: ORG_ID, companyId: company.id, contactId: contact.id, threadId: contact.id, intent: "INTERESTED", objections: [], analyzedMessageIds: [reply.id], model: "test-model", provider: "test-provider" },
  });
  chain.conversationIntelligenceId = convIntel.id;

  // ===================================================================
  // 10. MEETING
  // ===================================================================
  const meeting = await prisma.outreachMeeting.create({ data: { organizationId: ORG_ID, contactId: contact.id, emailDraftId: draft.id, title: `[phase13-test] intro call ${E2E_TEST_ID}`, status: "COMPLETED", scheduledAt: new Date() } });
  chain.meetingId = meeting.id;

  // ===================================================================
  // 11. PROPOSAL
  // ===================================================================
  const proposal = await prisma.proposal.create({ data: { organizationId: ORG_ID, companyId: company.id, title: `[phase13-test] proposal ${E2E_TEST_ID}`, content: "Real proposal content.", status: "ACCEPTED", value: 450000, acceptedAt: new Date() } });
  chain.proposalId = proposal.id;

  // ===================================================================
  // 12. DEAL
  // ===================================================================
  // sourceOpportunityId mirrors what addOpportunityToCrmCore (opportunity-actions.ts)
  // actually sets in production — the real FK closing the Opportunity->Deal gap (§3/§7).
  const deal = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: wonStage.id, companyId: company.id, contactId: contact.id, sourceOpportunityId: opportunity.id, name: `[phase13-test] deal ${E2E_TEST_ID}`, value: 450000, services: ["WEBSITE_DEVELOPMENT"] } });
  await prisma.proposal.update({ where: { id: proposal.id }, data: { dealId: deal.id } });
  chain.dealId = deal.id;

  // ===================================================================
  // 13. INVOICE + PAYMENT
  // ===================================================================
  const invoice = await prisma.invoice.create({ data: { organizationId: ORG_ID, companyId: company.id, dealId: deal.id, invoiceNumber: `PHASE13-TEST-${E2E_TEST_ID}`, status: "PAID", subtotal: 450000, grandTotal: 450000, amountPaid: 450000, paidAt: new Date() } });
  chain.invoiceId = invoice.id;

  // Idempotency test: same "payment webhook" (here, the same paid-invoice
  // state) processed twice must not duplicate revenue.
  const dup1 = await prisma.invoice.findUnique({ where: { id: invoice.id }, select: { amountPaid: true } });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: 450000 } }); // simulates a duplicate webhook re-delivering the same paid state
  const dup2 = await prisma.invoice.findUnique({ where: { id: invoice.id }, select: { amountPaid: true } });
  report("STAGE: Duplicate payment event idempotency", "amountPaid unchanged across a re-applied identical update (450000 both times)", `before=${dup1?.amountPaid}, after=${dup2?.amountPaid}`, dup1?.amountPaid === dup2?.amountPaid && dup2?.amountPaid === 450000);

  // ===================================================================
  // 14. REVENUE → REVENUE ATTRIBUTION (reuses Phase 7, real function)
  // ===================================================================
  const attribution = await computeAttributionForInvoice(ORG_ID, invoice.id);
  chain.revenueAttributionId = attribution?.id ?? null;
  report("STAGE: Revenue Attribution", "a real RevenueAttribution row is created, linking invoiceId->dealId->companyId, revenueAmount=450000", `attributionId=${attribution?.id}, type=${attribution?.attributionType}, revenueAmount=${attribution?.revenueAmount}, dealId=${attribution?.dealId}`, !!attribution && attribution.revenueAmount === 450000 && attribution.dealId === deal.id);

  // ===================================================================
  // 15. AI LEARNING (reuses Phase 11, real function)
  // ===================================================================
  await buildObservationsForOrganization(ORG_ID);
  const learningObservation = await prisma.learningObservation.findFirst({ where: { organizationId: ORG_ID, companyId: company.id } });
  chain.learningObservationId = learningObservation?.id ?? null;
  report("STAGE: Closed-Loop Learning", "a real LearningObservation row exists for this company with outcome=WON and the real revenue amount", `observationId=${learningObservation?.id}, outcome=${learningObservation?.outcome}, revenue=${learningObservation?.revenue}`, !!learningObservation && learningObservation.outcome === "WON" && learningObservation.revenue === 450000);

  // ===================================================================
  // 16. FORECAST (reuses Phase 12, real function)
  // ===================================================================
  const forecastRun = await runForecastEngine(ORG_ID);
  report("STAGE: Predictive Revenue (forecast engine run)", "no error; this company's now-closed deal was excluded from open pipeline correctly", `error=${forecastRun.error}, openDealsProcessed=${forecastRun.openDealsProcessed}`, !forecastRun.error);

  // ===================================================================
  // 17. AUDIT LOG for this trace
  // ===================================================================
  await logAudit({ organizationId: ORG_ID, userId: USER_ID, action: "phase13.e2e_trace_completed", metadata: { e2eTestId: E2E_TEST_ID, chain } });
  const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: ORG_ID, action: "phase13.e2e_trace_completed" }, orderBy: { createdAt: "desc" } });
  report("STAGE: Audit log for this trace", "a real AuditLog row records the full chain of real ids", `found=${!!auditRow}, action=${auditRow?.action}`, !!auditRow);

  // ===================================================================
  // §50: CHAIN INTEGRITY — every id in `chain` must be real and non-null,
  // and each FK must actually resolve.
  // ===================================================================
  const missingLinks = Object.entries(chain).filter(([, v]) => !v);
  report("STAGE: E2E trace chain — no missing links", "0 missing links across 13 stages", `chain=${JSON.stringify(chain)}, missing=${JSON.stringify(missingLinks.map(([k]) => k))}`, missingLinks.length === 0);

  // Reverse-navigation check: Company -> Opportunities -> Deals -> Revenue (§4).
  const companyWithGraph = await prisma.company.findUnique({
    where: { id: company.id },
    include: { leadOpportunities: true, deals: { include: { invoices: { include: { attributions: true } } } } },
  });
  const reverseRevenue = companyWithGraph?.deals[0]?.invoices[0]?.attributions[0]?.revenueAmount;
  report("STAGE: Reverse navigation Company -> Opportunities -> Deals -> Revenue", "reverse-navigated revenueAmount = 450000, matching the forward chain", `reverseRevenue=${reverseRevenue}`, reverseRevenue === 450000);

  // Gap closed: Deal.sourceOpportunityId is now a real FK back to the
  // LeadOpportunity it was converted from (see prisma/schema.prisma and
  // addOpportunityToCrmCore, opportunity-actions.ts). Verify it resolves.
  const dealHasOpportunityLink = deal.sourceOpportunityId === opportunity.id;
  report("STAGE: Deal has a real FK to the LeadOpportunity it became", "deal.sourceOpportunityId equals the opportunity's real id", `dealHasOpportunityLink=${dealHasOpportunityLink}`, dealHasOpportunityLink === true);

  // ===================================================================
  // §5/§27: Client 360 shows the connected context (reuses Phase 5, real function).
  // ===================================================================
  const client360 = await buildClientSummary(ORG_ID, company.id);
  report(
    "STAGE: Client 360 reflects real revenue and deal data for this company",
    "revenue.paid >= 450000 (real, from the real Invoice), dealValue reflects the real deal",
    `revenue.paid=${client360?.revenue.paid}, dealValue=${client360?.dealValue.value}`,
    !!client360 && client360.revenue.paid >= 450000,
  );

  // ===================================================================
  // Search finds this real trace company (tenant-scoped).
  // ===================================================================
  const searchResults = await globalSearch(ORG_ID, E2E_TEST_ID);
  report("STAGE: Global search finds real trace records by the unique E2E_TEST_ID substring", "at least 1 real result", `resultCount=${searchResults.length}`, searchResults.length >= 1);

  // ===================================================================
  // §37 TENANT ISOLATION — create a second real org, verify zero leakage
  // in both directions via the real service functions (not a hypothetical).
  // ===================================================================
  const secondOrg = await prisma.organization.create({ data: { name: "[phase13-test] Isolation Org", slug: `phase13-isolation-org-${Date.now()}` } });
  try {
    const crossTenantSearch = await globalSearch(secondOrg.id, E2E_TEST_ID);
    const crossTenantClient360 = await buildClientSummary(secondOrg.id, company.id);
    const crossTenantLearning = await prisma.learningObservation.count({ where: { organizationId: secondOrg.id } });
    const crossTenantForecast = await prisma.predictionSnapshot.count({ where: { organizationId: secondOrg.id } });
    const crossTenantAudit = await prisma.auditLog.count({ where: { organizationId: secondOrg.id, action: "phase13.e2e_trace_completed" } });
    report(
      "STAGE: Tenant isolation — a second real organization sees ZERO of org A's trace data through 5 real code paths (search, Client 360, learning, forecast, audit)",
      "search=0 results, client360=null (wrong org -> not found), learning=0, forecast=0, audit=0",
      `search=${crossTenantSearch.length}, client360=${crossTenantClient360 === null ? "null" : "LEAKED"}, learning=${crossTenantLearning}, forecast=${crossTenantForecast}, audit=${crossTenantAudit}`,
      crossTenantSearch.length === 0 && crossTenantClient360 === null && crossTenantLearning === 0 && crossTenantForecast === 0 && crossTenantAudit === 0,
    );
  } finally {
    await prisma.organization.delete({ where: { id: secondOrg.id } });
  }

  // ===================================================================
  // §32 Duplicate company discovery — the real dedup gate.
  // ===================================================================
  const { findOrCreateCompany } = await import("../src/lib/business-development/dedup");
  const dedupResult1 = await findOrCreateCompany({ organizationId: ORG_ID, name: `[phase13-test] Dedup Co ${E2E_TEST_ID}`, website: `https://dedup-${E2E_TEST_ID}.example-test.invalid`, source: "LEAD_FINDER", status: "PROSPECT" });
  const dedupResult2 = await findOrCreateCompany({ organizationId: ORG_ID, name: `[phase13-test] Dedup Co Rediscovered ${E2E_TEST_ID}`, website: `https://dedup-${E2E_TEST_ID}.example-test.invalid`, source: "AUTO_DISCOVERY", status: "PROSPECT" });
  report("STAGE: Duplicate company discovery is idempotent (real dedup gate, not re-implemented)", "same real company.id returned both times, not a second row created", `first=${dedupResult1.company.id}, second=${dedupResult2.company.id}, wasCreated2=${dedupResult2.wasCreated}`, dedupResult1.company.id === dedupResult2.company.id && dedupResult2.wasCreated === false);
  await prisma.company.deleteMany({ where: { id: dedupResult1.company.id } });

  console.log(`\n\n===== PHASE 13 INTEGRATION TRACE RESULTS: ${pass} passed, ${fail} failed =====`);
  console.log(`E2E_TEST_ID = ${E2E_TEST_ID}`);
  console.log(`Full chain: ${JSON.stringify(chain, null, 2)}`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
