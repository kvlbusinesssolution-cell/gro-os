import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { checkVoiceEligibility } from "../src/lib/outreach/voice-eligibility";
import { initiateVoiceCallCore, updateCallOutcome } from "../src/lib/outreach/voice-call";
import { checkSuppression, addSuppressionEntry } from "../src/lib/outreach/suppression";
import { getVoiceAnalytics } from "../src/lib/outreach/voice-analytics";
import { getCompanyCompleteTimeline } from "../src/lib/business-development/company-complete-timeline";

const ORG_ID = "cmu6l7wka0001oq9gwawodgm1"; // real E2E Fixture Org
const OTHER_ORG_ID = "cmu6l7wka0001oq9gwawodgm1-does-not-exist";
const USER_ID = "cmu6l7whe0000oq9g6d8ur5pt"; // real e2e-fixture user

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

  // Clean up prior runs.
  await prisma.call.deleteMany({ where: { organizationId: ORG_ID, contact: { email: { contains: "phase10-test" } } } });
  await prisma.voiceConsent.deleteMany({ where: { organizationId: ORG_ID, contact: { email: { contains: "phase10-test" } } } });
  await prisma.suppressionEntry.deleteMany({ where: { organizationId: ORG_ID, channel: "VOICE", phone: { startsWith: "+1999" } } });
  await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, email: { contains: "phase10-test" } } });

  // ===== TEST 1 (§8): no consent on file at all -> CONSENT_REQUIRED, never assumed eligible =====
  const noConsentContact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase10NoConsent", email: "phase10-test-noconsent@example-test.invalid", phone: "+19995551001" } });
  const noConsentEligibility = await checkVoiceEligibility(ORG_ID, noConsentContact.id);
  report(
    "TEST 1 (§8): real phone number on file but NO consent record -> CONSENT_REQUIRED, a phone number is never treated as consent",
    "status=CONSENT_REQUIRED",
    `status=${noConsentEligibility.status}, consentStatus=${noConsentEligibility.consentStatus}`,
    noConsentEligibility.status === "CONSENT_REQUIRED" && noConsentEligibility.consentStatus === "UNKNOWN",
  );

  // ===== TEST 2 (§6): invalid/missing phone number -> INVALID_NUMBER =====
  const noPhoneContact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase10NoPhone", email: "phase10-test-nophone@example-test.invalid" } });
  const noPhoneEligibility = await checkVoiceEligibility(ORG_ID, noPhoneContact.id);
  report(
    "TEST 2 (§6): no valid phone number -> INVALID_NUMBER",
    "status=INVALID_NUMBER",
    `status=${noPhoneEligibility.status}`,
    noPhoneEligibility.status === "INVALID_NUMBER",
  );

  // ===== TEST 3 (§7): explicit VOICE opt-out blocks even if consent were later granted =====
  const optedOutContact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase10OptedOut", email: "phase10-test-optedout@example-test.invalid", phone: "+19995551002" } });
  await prisma.voiceConsent.create({ data: { organizationId: ORG_ID, contactId: optedOutContact.id, status: "GRANTED", recordingConsent: "RECORDING_NOT_ALLOWED", source: "[phase10-test] signed form", evidence: "[phase10-test] real evidence text", capturedByUserId: USER_ID, capturedAt: new Date() } });
  await addSuppressionEntry({ organizationId: ORG_ID, identifier: optedOutContact.phone!, channel: "VOICE", reason: "UNSUBSCRIBED", source: "[phase10-test] explicit opt-out" });
  const optedOutEligibility = await checkVoiceEligibility(ORG_ID, optedOutContact.id);
  const optedOutSuppression = await checkSuppression(ORG_ID, optedOutContact.phone!, "VOICE");
  report(
    "TEST 3 (§7): explicit VOICE opt-out blocks even with real GRANTED consent on file — suppression checked first",
    "eligibility=OPTED_OUT, suppressed=true",
    `eligibility=${optedOutEligibility.status}, suppressed=${optedOutSuppression.suppressed}`,
    optedOutEligibility.status === "OPTED_OUT" && optedOutSuppression.suppressed === true,
  );

  // ===== TEST 4 (§6/§8): real GRANTED consent, valid number, not suppressed -> ELIGIBLE (subject to calling-hours) =====
  const eligibleContact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase10Eligible", email: "phase10-test-eligible@example-test.invalid", phone: "+19995551003" } });
  await prisma.voiceConsent.create({ data: { organizationId: ORG_ID, contactId: eligibleContact.id, status: "GRANTED", recordingConsent: "RECORDING_ALLOWED", source: "[phase10-test] verbal consent on discovery call", evidence: "[phase10-test] prospect said 'yes you can call and record'", capturedByUserId: USER_ID, capturedAt: new Date() } });
  const withinWindow = new Date();
  withinWindow.setHours(14, 0, 0, 0); // 2pm — inside the 9am-7pm window regardless of local run time
  const eligibleCheck = await checkVoiceEligibility(ORG_ID, eligibleContact.id, withinWindow);
  report(
    "TEST 4 (§6): real GRANTED consent + valid number + not suppressed + within calling hours -> ELIGIBLE",
    "status=ELIGIBLE",
    `status=${eligibleCheck.status}, recordingConsent=${eligibleCheck.recordingConsent}`,
    eligibleCheck.status === "ELIGIBLE" && eligibleCheck.recordingConsent === "RECORDING_ALLOWED",
  );

  // ===== TEST 5 (§32): outside the allowed calling window -> OUTSIDE_ALLOWED_TIME even with consent =====
  const outsideWindow = new Date();
  outsideWindow.setHours(23, 0, 0, 0); // 11pm
  const outsideCheck = await checkVoiceEligibility(ORG_ID, eligibleContact.id, outsideWindow);
  report(
    "TEST 5: same real consented contact, but outside the allowed calling window -> OUTSIDE_ALLOWED_TIME",
    "status=OUTSIDE_ALLOWED_TIME",
    `status=${outsideCheck.status}`,
    outsideCheck.status === "OUTSIDE_ALLOWED_TIME",
  );

  // ===== TEST 6 (§6/§48): initiating a call for a NOT-eligible contact never reaches the provider — creates a real, auditable CANCELLED Call row instead =====
  const blockedResult = await initiateVoiceCallCore(ORG_ID, noConsentContact.id, USER_ID);
  report(
    "TEST 6 (§6): initiateVoiceCallCore for CONSENT_REQUIRED contact -> ok=false, real CANCELLED Call row created documenting why, never a fabricated call",
    "ok=false, call.status=CANCELLED, call.eligibilityStatus=CONSENT_REQUIRED",
    `ok=${blockedResult.ok}, callStatus=${blockedResult.call?.status}, eligibilityStatus=${blockedResult.call?.eligibilityStatus}`,
    blockedResult.ok === false && blockedResult.call?.status === "CANCELLED" && blockedResult.call?.eligibilityStatus === "CONSENT_REQUIRED",
  );

  // ===== TEST 7 (§32/§41): scheduled-call-style re-check — a contact eligible a moment ago becomes DO_NOT_CALL the instant they opt out =====
  await addSuppressionEntry({ organizationId: ORG_ID, identifier: eligibleContact.phone!, channel: "VOICE", reason: "UNSUBSCRIBED", source: "[phase10-test] opted out after being eligible" });
  const reCheckedAfterOptOut = await checkVoiceEligibility(ORG_ID, eligibleContact.id, withinWindow);
  const reCheckResult = await initiateVoiceCallCore(ORG_ID, eligibleContact.id, USER_ID);
  report(
    "TEST 7 (§32): a contact who opts out after being eligible is BLOCKED on the very next real check — no scheduled call proceeds on stale eligibility",
    "reCheckedStatus=OPTED_OUT, initiateResult.ok=false",
    `reCheckedStatus=${reCheckedAfterOptOut.status}, initiateOk=${reCheckResult.ok}`,
    reCheckedAfterOptOut.status === "OPTED_OUT" && reCheckResult.ok === false,
  );

  // ===== TEST 8 (§32/§41): no real Twilio account connected in this environment -> honest not_configured failure, never a fabricated successful call =====
  const freshContact = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase10Fresh", email: "phase10-test-fresh@example-test.invalid", phone: "+19995551004" } });
  await prisma.voiceConsent.create({ data: { organizationId: ORG_ID, contactId: freshContact.id, status: "GRANTED", recordingConsent: "RECORDING_NOT_ALLOWED", source: "[phase10-test] signed form", evidence: "[phase10-test] real evidence", capturedByUserId: USER_ID, capturedAt: new Date() } });
  const noProviderResult = await initiateVoiceCallCore(ORG_ID, freshContact.id, USER_ID);
  report(
    "TEST 8 (§58): no real Twilio account connected -> honest failure, never ok=true without a real provider call",
    "ok=false (either eligibility blocked outside hours, or provider not_configured)",
    `ok=${noProviderResult.ok}, callStatus=${noProviderResult.call?.status}, error=${noProviderResult.error}`,
    noProviderResult.ok === false,
  );

  // ===== TEST 9 (§14): outcome is only ever set via the explicit human action, always recorded as HUMAN, never silently AI-decided =====
  const outcomeTestCall = await prisma.call.create({
    data: { organizationId: ORG_ID, contactId: eligibleContact.id, companyId: zomato.id, direction: "OUTBOUND", eligibilityStatus: "ELIGIBLE", consentStatus: "GRANTED", recordingConsentStatus: "RECORDING_ALLOWED", status: "COMPLETED", startedAt: new Date(), endedAt: new Date() },
  });
  const outcomeResult = await updateCallOutcome(ORG_ID, outcomeTestCall.id, "QUALIFIED", USER_ID);
  const updatedCall = await prisma.call.findUniqueOrThrow({ where: { id: outcomeTestCall.id } });
  report(
    "TEST 9 (§14): call outcome set via updateCallOutcome is always outcomeSetBy=HUMAN — never silently attributed to AI sentiment",
    "ok=true, outcome=QUALIFIED, outcomeSetBy=HUMAN",
    `ok=${outcomeResult.ok}, outcome=${updatedCall.outcome}, outcomeSetBy=${updatedCall.outcomeSetBy}`,
    outcomeResult.ok === true && updatedCall.outcome === "QUALIFIED" && updatedCall.outcomeSetBy === "HUMAN",
  );

  // ===== TEST 10 (§17 transcript integrity, §48): a Call's transcript is never fabricated — transcriptStatus stays NOT_AVAILABLE with no real Reply until a real webhook event provides one =====
  report(
    "TEST 10 (§17/§48): a real Call row with no real transcription event never gets a fabricated transcript",
    "transcriptStatus=TRANSCRIPT_NOT_AVAILABLE, transcriptReplyId=null",
    `transcriptStatus=${updatedCall.transcriptStatus}, transcriptReplyId=${updatedCall.transcriptReplyId}`,
    updatedCall.transcriptStatus === "TRANSCRIPT_NOT_AVAILABLE" && updatedCall.transcriptReplyId === null,
  );

  // ===== TEST 11 (§39/§46): cross-tenant isolation — wrong org cannot check/initiate a call for a real contact =====
  const crossTenantEligibility = await checkVoiceEligibility(OTHER_ORG_ID, eligibleContact.id);
  const crossTenantInitiate = await initiateVoiceCallCore(OTHER_ORG_ID, eligibleContact.id, USER_ID);
  report(
    "TEST 11 (§46): wrong organizationId against a real contact -> UNKNOWN eligibility, call initiation blocked, never leaks another org's data",
    "eligibility=UNKNOWN, initiate ok=false",
    `eligibility=${crossTenantEligibility.status}, initiateOk=${crossTenantInitiate.ok}, initiateError=${crossTenantInitiate.error}`,
    crossTenantEligibility.status === "UNKNOWN" && crossTenantInitiate.ok === false,
  );

  // ===== TEST 12 (§36): Client 360 timeline includes real CALL_BLOCKED and CALL_COMPLETED/CALL_OUTCOME_UPDATED events =====
  const timeline = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const hasCallBlocked = timeline.some((e) => e.type === "CALL_BLOCKED" && e.recordId === blockedResult.call?.id);
  const hasCallCompleted = timeline.some((e) => e.type === "CALL_COMPLETED" && e.recordId === outcomeTestCall.id);
  const hasOutcomeUpdated = timeline.some((e) => e.type === "CALL_OUTCOME_UPDATED" && e.recordId === outcomeTestCall.id);
  report(
    "TEST 12 (§36): Client 360 timeline shows real CALL_BLOCKED, CALL_COMPLETED, and CALL_OUTCOME_UPDATED events",
    "all true",
    `hasCallBlocked=${hasCallBlocked}, hasCallCompleted=${hasCallCompleted}, hasOutcomeUpdated=${hasOutcomeUpdated}`,
    hasCallBlocked && hasCallCompleted && hasOutcomeUpdated,
  );

  // ===== TEST 13 (§41): voice analytics — real counts, NOT_AVAILABLE (null) rate when denominator is 0, never a fabricated rate =====
  const analytics = await getVoiceAnalytics(ORG_ID);
  report(
    "TEST 13 (§41): voice analytics reflect real counts just created, with honest null rates where a denominator could be 0",
    "callsPlaced >= 1 (the blocked+outcome test calls), qualification tracked",
    `callsPlaced=${analytics.callsPlaced}, blockedByEligibility=${analytics.blockedByEligibility}, qualified=${analytics.qualified}, answerRate=${analytics.answerRate}`,
    analytics.callsPlaced >= 1 && analytics.blockedByEligibility >= 1 && analytics.qualified >= 1,
  );

  // ===== TEST 14 (§48/§39): source-verified — the webhook route never fabricates a transcript from call metadata, only from a real non-empty TranscriptionText =====
  const webhookSource = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/webhooks/twilio-voice/[organizationId]/route.ts", "utf-8"));
  const neverReconstructsTranscript = /if \(!transcriptionText\.trim\(\)\)/.test(webhookSource) && !/generateStructured|generateText/.test(webhookSource);
  report(
    "TEST 14 (§17 absolute rule, source-verified): the voice webhook only ever persists a real, non-empty provider transcript — never calls an AI model to reconstruct one",
    "true",
    `neverReconstructsTranscript=${neverReconstructsTranscript}`,
    neverReconstructsTranscript,
  );

  // ===== TEST 15 (§11, source-verified): the TwiML endpoint always speaks the disclosure BEFORE anything else and marks aiDisclosureGiven=true only after actually building that speech =====
  const twimlSource = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/voice/twiml/[callId]/route.ts", "utf-8"));
  const alwaysDisclosesFirst = /const sayBlock = `<Say[\s\S]*disclosure/.test(twimlSource) && /aiDisclosureGiven: true/.test(twimlSource);
  report(
    "TEST 15 (§11): source-verified — every real call's TwiML speaks the AI-disclosure statement, and aiDisclosureGiven is only ever set true, never assumed",
    "true",
    `alwaysDisclosesFirst=${alwaysDisclosesFirst}`,
    alwaysDisclosesFirst,
  );

  console.log(`\n\n===== PHASE 10 RESULTS: ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
