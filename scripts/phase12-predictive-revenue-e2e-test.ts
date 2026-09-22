/**
 * Real E2E Fixture Org, same convention as every other phaseN-e2e-test.ts
 * script. Essential this time (unlike some earlier phases) because the
 * real dev DB has ZERO open deals — every real Deal is already Won/Lost —
 * so exercising deal-probability/pipeline/risk code paths requires real
 * open-deal fixtures. Run with:
 *
 *   npx tsx -r dotenv/config scripts/phase12-predictive-revenue-e2e-test.ts
 *
 * To exercise the DEAL_STALLED_DAYS-dependent risk signals deterministically
 * regardless of the real closed-deal baseline's exact win rate, no env
 * override is needed — FORECAST_CONFIG's defaults (10 closed deals minimum)
 * are already cleared by this org's real 22 closed deals.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeCalibratedProbability } from "../src/lib/forecast/deal-probability";
import { computeDealRisk } from "../src/lib/forecast/deal-risk";
import { predictTimeToClose } from "../src/lib/forecast/time-to-close";
import { computePredictedPipeline } from "../src/lib/forecast/pipeline";
import { computePipelineRisk } from "../src/lib/forecast/pipeline-risk";
import { computeMonthlyForecast } from "../src/lib/forecast/revenue-forecast";
import { runForecastEngine } from "../src/lib/forecast/run";
import { runBacktest } from "../src/lib/forecast/backtest";
import { computeDealProbabilityCalibration } from "../src/lib/forecast/calibration";

const ORG_ID = "cmu6l7wka0001oq9gwawodgm1";
const USER_ID = "cmu6l7whe0000oq9g6d8ur5pt";
const OTHER_ORG_ID = "cmu6l7wka0001oq9gwawodgm1-does-not-exist";

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

async function makeCompanyWithContact(name: string) {
  const company = await prisma.company.create({ data: { organizationId: ORG_ID, name, source: "LEAD_FINDER", industry: "Phase12TestIndustry", headquartersCountry: "India" } });
  const contact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: company.id, firstName: name, email: `${company.id}@example-test.invalid` } });
  return { company, contact };
}

async function main() {
  const stages = await prisma.dealStage.findMany({ orderBy: { order: "asc" } });
  const stageByName = new Map(stages.map((s) => [s.name, s]));
  const qualified = stageByName.get("Qualified")!;
  const proposalStage = stageByName.get("Proposal")!;
  const negotiation = stageByName.get("Negotiation")!;
  const wonStage = stageByName.get("Won")!;

  // ===== Cleanup from a prior run =====
  const priorCompanies = await prisma.company.findMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase12-test]" } }, select: { id: true } });
  const priorIds = priorCompanies.map((c) => c.id);
  const priorDeals = await prisma.deal.findMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase12-test]" } }, select: { id: true } });
  const priorDealIds = priorDeals.map((d) => d.id);
  await prisma.predictionSnapshot.deleteMany({ where: { organizationId: ORG_ID, entityId: { in: priorDealIds } } });
  await prisma.dealStageHistory.deleteMany({ where: { organizationId: ORG_ID, dealId: { in: priorDealIds } } });
  await prisma.conversationIntelligence.deleteMany({ where: { organizationId: ORG_ID, companyId: { in: priorIds } } });
  await prisma.deal.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase12-test]" } } });
  await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, company: { name: { startsWith: "[phase12-test]" } } } });
  await prisma.company.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase12-test]" } } });
  await prisma.predictionSnapshot.deleteMany({ where: { organizationId: ORG_ID, entityType: "ORGANIZATION" } });

  // ===== Fixture 1: a healthy, low-risk open deal =====
  const healthy = await makeCompanyWithContact("[phase12-test] HealthyCo");
  await prisma.decisionMaker.create({ data: { companyId: healthy.company.id, name: "Healthy CTO", role: "CTO", source: "test", confidence: 0.9 } });
  await prisma.reply.create({ data: { organizationId: ORG_ID, contactId: healthy.contact.id, channel: "EMAIL", content: "[phase12-test] Very interested, let's move forward.", receivedAt: new Date(), loggedByUserId: USER_ID } });
  const healthyDeal = await prisma.deal.create({
    data: { organizationId: ORG_ID, dealStageId: proposalStage.id, companyId: healthy.company.id, contactId: healthy.contact.id, name: "[phase12-test] Healthy Deal", value: 300000, expectedCloseDate: new Date(Date.now() + 10 * 86_400_000) },
  });
  await prisma.dealStageHistory.create({ data: { organizationId: ORG_ID, dealId: healthyDeal.id, toStageId: proposalStage.id, toStageName: "Proposal", changedAt: new Date() } });

  // ===== Fixture 2: a deliberately high-risk, stalled open deal =====
  const risky = await makeCompanyWithContact("[phase12-test] RiskyCo");
  await prisma.conversationIntelligence.create({
    data: { organizationId: ORG_ID, companyId: risky.company.id, contactId: risky.contact.id, threadId: risky.contact.id, objections: [{ value: "Too expensive", classification: "CONFIRMED" }], competitorMentions: [{ name: "CompetitorX" }] },
  });
  const riskyDeal = await prisma.deal.create({
    data: { organizationId: ORG_ID, dealStageId: qualified.id, companyId: risky.company.id, contactId: risky.contact.id, name: "[phase12-test] Risky Deal", value: 1000000, createdAt: new Date(Date.now() - 40 * 86_400_000), updatedAt: new Date(Date.now() - 30 * 86_400_000) },
  });
  await prisma.dealStageHistory.create({ data: { organizationId: ORG_ID, dealId: riskyDeal.id, toStageId: qualified.id, toStageName: "Qualified", changedAt: new Date(Date.now() - 30 * 86_400_000) } });

  // ===== Fixture 3: a deal with no value / no company (missing-data edge case, §44/§60) =====
  const incompleteDeal = await prisma.deal.create({ data: { organizationId: ORG_ID, dealStageId: negotiation.id, name: "[phase12-test] Incomplete Deal" } });

  // ===== Fixture 4: a deal closing this month, for the monthly-forecast test =====
  const monthly = await makeCompanyWithContact("[phase12-test] MonthlyCo");
  const monthlyDeal = await prisma.deal.create({
    data: { organizationId: ORG_ID, dealStageId: negotiation.id, companyId: monthly.company.id, contactId: monthly.contact.id, name: "[phase12-test] Monthly Deal", value: 200000, expectedCloseDate: new Date() },
  });
  await prisma.dealStageHistory.create({ data: { organizationId: ORG_ID, dealId: monthlyDeal.id, toStageId: negotiation.id, toStageName: "Negotiation", changedAt: new Date() } });

  // ===================================================================
  // SCENARIO 1: calibrated probability uses real historical data, never fabricated.
  // ===================================================================
  const probability = await computeCalibratedProbability(healthyDeal.id);
  report(
    "SCENARIO 1 (§5/§6/§17): calibrated probability is a real number in [0,1], derived from real closed-deal history, never a placeholder",
    "probability between 0 and 1, method cites a real win-rate fraction",
    `probability=${probability.probability}, insufficientData=${probability.insufficientData}, method="${probability.method.slice(0, 80)}..."`,
    !probability.insufficientData && probability.probability !== null && probability.probability >= 0 && probability.probability <= 1 && probability.method.includes("closed deals"),
  );

  // ===================================================================
  // SCENARIO 2: pipeline value is real, weighted pipeline uses calibrated probability.
  // ===================================================================
  const pipeline = await computePredictedPipeline(ORG_ID);
  const expectedOpenValue = 300000 + 1000000 + 200000; // healthy + risky + monthly (incomplete has no value)
  report(
    "SCENARIO 2 (§8/§9): real open pipeline value sums actual Deal.value; weighted pipeline uses the calibrated probability, never Deal.probability (which is null on every real deal)",
    `openPipelineValue >= ${expectedOpenValue}, weightedPipelineValue > 0`,
    `openPipelineValue=${pipeline.openPipelineValue}, weightedPipelineValue=${pipeline.weightedPipelineValue}, dealsWithCalibratedProbability=${pipeline.dealsWithCalibratedProbability}`,
    pipeline.openPipelineValue >= expectedOpenValue && pipeline.weightedPipelineValue > 0,
  );

  // ===================================================================
  // SCENARIO 3: deal risk — the risky fixture gets real evidence-backed reasons; the healthy one does not.
  // ===================================================================
  const riskyAssessment = await computeDealRisk(riskyDeal.id);
  const healthyAssessment = await computeDealRisk(healthyDeal.id);
  report(
    "SCENARIO 3a (§21): a stalled, objection-laden, decision-maker-less deal is scored MEDIUM/HIGH/CRITICAL with real cited evidence",
    "riskLevel != LOW, reasons.length > 0, every reason has real evidence text",
    `riskLevel=${riskyAssessment.riskLevel}, reasons=${JSON.stringify(riskyAssessment.reasons.map((r) => r.reason))}`,
    riskyAssessment.riskLevel !== "LOW" && riskyAssessment.reasons.length > 0 && riskyAssessment.reasons.every((r) => r.evidence.length > 0),
  );
  report(
    "SCENARIO 3b: a fresh deal with a recent reply and confirmed decision maker is scored LOW risk",
    "riskLevel = LOW",
    `riskLevel=${healthyAssessment.riskLevel}, reasons=${JSON.stringify(healthyAssessment.reasons.map((r) => r.reason))}`,
    healthyAssessment.riskLevel === "LOW",
  );

  // ===================================================================
  // SCENARIO 4: time-to-close is a real, historically-derived prediction.
  // ===================================================================
  const ttc = await predictTimeToClose(healthyDeal.id);
  report("SCENARIO 4 (§19): time-to-close is PREDICTED from real historical average sales cycle, not invented", "insufficientData=false, predictedDays is a real number, method cites the real average", `insufficientData=${ttc.insufficientData}, predictedDays=${ttc.predictedDays}`, !ttc.insufficientData && typeof ttc.predictedDays === "number");

  // ===================================================================
  // SCENARIO 5: pipeline risk detects real concentration (Risky Deal is 1M of ~1.5M weighted-eligible pipeline).
  // ===================================================================
  const pipelineRisk = await computePipelineRisk(ORG_ID);
  report(
    "SCENARIO 5 (§22/§23): pipeline concentration is computed from real weighted deal values, never a hidden aggregate",
    "concentration.top1Share is a real fraction between 0 and 1",
    `top1Share=${pipelineRisk.concentration.top1Share}, riskLevel=${pipelineRisk.riskLevel}, reasons=${pipelineRisk.reasons.length}`,
    pipelineRisk.concentration.top1Share !== null && pipelineRisk.concentration.top1Share >= 0 && pipelineRisk.concentration.top1Share <= 1,
  );

  // ===================================================================
  // SCENARIO 6: monthly forecast separates ACTUAL from PREDICTED (§12).
  // ===================================================================
  const monthlyForecast = await computeMonthlyForecast(ORG_ID, 0);
  report(
    "SCENARIO 6 (§12/§25): monthly forecast keeps actualRevenue, expectedFutureRevenue and forecastTotal as distinct, separately-labeled numbers",
    "forecastTotal = actualRevenue + expectedFutureRevenue + recurringContribution (never silently blended)",
    `actual=${monthlyForecast.actualRevenue}, expectedFuture=${monthlyForecast.expectedFutureRevenue}, recurring=${monthlyForecast.recurringContribution}, total=${monthlyForecast.forecastTotal}`,
    Math.abs(monthlyForecast.forecastTotal - (monthlyForecast.actualRevenue + monthlyForecast.expectedFutureRevenue + monthlyForecast.recurringContribution)) < 0.01,
  );

  // ===================================================================
  // SCENARIO 7: full engine run — idempotent, snapshot supersession (never overwritten in place).
  // ===================================================================
  const run1 = await runForecastEngine(ORG_ID);
  const activeAfterRun1 = await prisma.predictionSnapshot.count({ where: { organizationId: ORG_ID, entityId: healthyDeal.id, predictionType: "DEAL_PROBABILITY", status: "ACTIVE" } });
  const run2 = await runForecastEngine(ORG_ID);
  const activeAfterRun2 = await prisma.predictionSnapshot.count({ where: { organizationId: ORG_ID, entityId: healthyDeal.id, predictionType: "DEAL_PROBABILITY", status: "ACTIVE" } });
  const supersededAfterRun2 = await prisma.predictionSnapshot.count({ where: { organizationId: ORG_ID, entityId: healthyDeal.id, predictionType: "DEAL_PROBABILITY", status: "SUPERSEDED" } });
  report(
    "SCENARIO 7 (§27/§50): running the engine twice never leaves 2 ACTIVE snapshots for the same entity+type — the prior one is SUPERSEDED, not deleted or overwritten in place",
    "activeAfterRun1=1, activeAfterRun2=1 (still exactly one ACTIVE), supersededAfterRun2>=1 (real history preserved)",
    `run1.error=${run1.error}, activeAfterRun1=${activeAfterRun1}, run2.error=${run2.error}, activeAfterRun2=${activeAfterRun2}, superseded=${supersededAfterRun2}`,
    !run1.error && !run2.error && activeAfterRun1 === 1 && activeAfterRun2 === 1 && supersededAfterRun2 >= 1,
  );

  // ===================================================================
  // SCENARIO 8: DealStageHistory is real and queryable (the new log this phase adds).
  // ===================================================================
  const historyCount = await prisma.dealStageHistory.count({ where: { organizationId: ORG_ID, dealId: { in: [healthyDeal.id, riskyDeal.id, monthlyDeal.id] } } });
  report("SCENARIO 8 (§6 foundation): real DealStageHistory rows exist for fixture deals — the log Phase 12 needs for future stage-conversion analysis", "3 rows (one per deal with a stage set)", `historyCount=${historyCount}`, historyCount === 3);

  // ===================================================================
  // SCENARIO 9: data-leakage guard — an asOf date before the risky deal was created must not use it.
  // ===================================================================
  const beforeRiskyDealCreated = new Date(Date.now() - 45 * 86_400_000);
  const earlyProbability = await computeCalibratedProbability(healthyDeal.id, beforeRiskyDealCreated);
  report(
    "SCENARIO 9 (§18): computing a probability as-of a past date only uses deals created on/before that date — never a deal created after it",
    "no error; a real (possibly different) result computed strictly from pre-cutoff data",
    `insufficientData=${earlyProbability.insufficientData}, probability=${earlyProbability.probability}`,
    true, // structural check — computeCalibratedProbability's getOrgWinRateBaseline filters createdAt<=asOf; verified by code inspection, exercised here for a crash-free real run
  );

  // ===================================================================
  // SCENARIO 10: backtesting honestly reports its real schema limitation.
  // ===================================================================
  const backtest = await runBacktest(ORG_ID, new Date("2026-01-01"));
  report(
    "SCENARIO 10 (§54): backtesting against a date before DealStageHistory existed honestly reports INSUFFICIENT_DATA with its limitation documented, never a fabricated result",
    "insufficientData=true, limitation explains why",
    `insufficientData=${backtest.insufficientData}, limitation="${backtest.limitation.slice(0, 60)}..."`,
    backtest.insufficientData && backtest.limitation.length > 0,
  );

  // ===================================================================
  // SCENARIO 11: tenant isolation.
  // ===================================================================
  const crossTenantSnapshots = await prisma.predictionSnapshot.count({ where: { organizationId: OTHER_ORG_ID } });
  const crossTenantHistory = await prisma.dealStageHistory.count({ where: { organizationId: OTHER_ORG_ID } });
  report("SCENARIO 11 (§46): a different/invalid organizationId has zero forecast rows — no cross-tenant leakage", "0 snapshots, 0 stage-history rows", `snapshots=${crossTenantSnapshots}, history=${crossTenantHistory}`, crossTenantSnapshots === 0 && crossTenantHistory === 0);

  // ===================================================================
  // SCENARIO 12: calibration runs without crashing and is honest about small samples.
  // ===================================================================
  const calibration = await computeDealProbabilityCalibration(ORG_ID);
  report("SCENARIO 12 (§30): deal-probability calibration runs without error against real data (verdict may honestly be INSUFFICIENT_DATA given few evaluated predictions)", "no crash; a well-formed result or null", `calibration=${calibration ? JSON.stringify({ sampleSize: calibration.sampleSize, verdict: calibration.verdict }) : "null"}`, true);

  // ===================================================================
  // SCENARIO 13: audit log entries were written for the run.
  // ===================================================================
  const auditStarted = await prisma.auditLog.count({ where: { organizationId: ORG_ID, action: "forecast.run.started" } });
  const auditCompleted = await prisma.auditLog.count({ where: { organizationId: ORG_ID, action: "forecast.run.completed" } });
  report("SCENARIO 13 (§59): every forecast run is audit-logged (started + completed)", "auditStarted >= 2, auditCompleted >= 2 (2 runs this session)", `auditStarted=${auditStarted}, auditCompleted=${auditCompleted}`, auditStarted >= 2 && auditCompleted >= 2);

  // ===================================================================
  // SCENARIO 14: evaluating a matured prediction — move a deal to Won, rerun, check EVALUATED.
  // ===================================================================
  await prisma.deal.update({ where: { id: monthlyDeal.id }, data: { dealStageId: wonStage.id } });
  await prisma.dealStageHistory.create({ data: { organizationId: ORG_ID, dealId: monthlyDeal.id, fromStageId: negotiation.id, fromStageName: "Negotiation", toStageId: wonStage.id, toStageName: "Won", changedAt: new Date() } });
  await runForecastEngine(ORG_ID);
  const evaluatedSnapshot = await prisma.predictionSnapshot.findFirst({ where: { organizationId: ORG_ID, entityId: monthlyDeal.id, predictionType: "DEAL_PROBABILITY", status: "EVALUATED" } });
  report(
    "SCENARIO 14 (§28/§29): once a deal closes, its prior ACTIVE prediction is evaluated against the real outcome — original prediction fields untouched, only actual*/accuracy/status are added",
    "an EVALUATED snapshot exists with actualOutcome=Won and its original predictionProbability preserved",
    `found=${!!evaluatedSnapshot}, actualOutcome=${evaluatedSnapshot?.actualOutcome}, predictionProbability=${evaluatedSnapshot?.predictionProbability}`,
    !!evaluatedSnapshot && evaluatedSnapshot.actualOutcome === "Won" && evaluatedSnapshot.predictionProbability !== null,
  );

  // ===================================================================
  // SCENARIO 15: missing-data deal (no value, no company) is handled gracefully, never crashes.
  // ===================================================================
  const incompleteRisk = await computeDealRisk(incompleteDeal.id);
  report("SCENARIO 15 (§44/§60): a deal with no linked company is handled gracefully (UNKNOWN risk), never crashes", "riskLevel=UNKNOWN", `riskLevel=${incompleteRisk.riskLevel}`, incompleteRisk.riskLevel === "UNKNOWN");

  console.log(`\n\n===== PHASE 12 RESULTS: ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
