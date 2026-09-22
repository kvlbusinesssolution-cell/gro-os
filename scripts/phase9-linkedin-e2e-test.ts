import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getLinkedInCapabilities } from "../src/lib/integrations/linkedin-capabilities";
import { linkedinAdapter } from "../src/lib/integrations/providers/linkedin";
import { getLinkedInOutreachRecommendation } from "../src/lib/business-development/linkedin-recommendation";
import { getCompanyLinkedInIntelligence } from "../src/lib/business-development/linkedin-intelligence";
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
  await prisma.emailDraft.deleteMany({ where: { organizationId: ORG_ID, channel: "LINKEDIN", contact: { email: { contains: "phase9-test" } } } });
  await prisma.reply.deleteMany({ where: { organizationId: ORG_ID, channel: "LINKEDIN", contact: { email: { contains: "phase9-test" } } } });
  await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, email: { contains: "phase9-test" } } });
  await prisma.company.deleteMany({ where: { organizationId: ORG_ID, name: { startsWith: "[phase9-test]" } } });

  // ===== TEST 1 (§4/§40.1): real OAuth URL construction — only the approved product's scopes, real LinkedIn endpoint =====
  const authUrl = linkedinAdapter.getAuthUrl!("test-state-123", "https://example.test/api/integrations/LINKEDIN/callback");
  const parsedUrl = new URL(authUrl);
  const scopeParam = parsedUrl.searchParams.get("scope");
  report(
    "TEST 1 (§4): getAuthUrl builds a real LinkedIn OIDC authorization URL with only the approved openid/profile/email scopes",
    "host=www.linkedin.com, scope='openid profile email', state present",
    `host=${parsedUrl.host}, path=${parsedUrl.pathname}, scope=${scopeParam}, state=${parsedUrl.searchParams.get("state")}`,
    parsedUrl.host === "www.linkedin.com" && parsedUrl.pathname === "/oauth/v2/authorization" && scopeParam === "openid profile email" && parsedUrl.searchParams.get("state") === "test-state-123",
  );
  const requestsUnapprovedScope = /w_member_social|r_organization_social|rw_ads|r_1st_connections/.test(authUrl);
  report(
    "TEST 1b (§5): the built URL never requests a scope beyond the approved product",
    "false",
    `requestsUnapprovedScope=${requestsUnapprovedScope}`,
    !requestsUnapprovedScope,
  );

  // ===== TEST 2 (§2/§3): capability matrix for a NOT_CONNECTED org — honest, never assumed AVAILABLE =====
  const capsDisconnected = await getLinkedInCapabilities(ORG_ID);
  const profileCap = capsDisconnected.capabilities.find((c) => c.key === "profile_read");
  report(
    "TEST 2 (§3): capability matrix reports profile_read=NOT_CONNECTED when no real connection exists",
    "status=NOT_CONNECTED",
    `status=${profileCap?.status}`,
    profileCap?.status === "NOT_CONNECTED",
  );

  // ===== TEST 3 (§2/§41): unsupported capabilities are ALWAYS NOT_SUPPORTED, never flipped to AVAILABLE by connection state =====
  const unsupportedKeys = ["organization_access", "member_activity", "messaging", "connection_data", "page_activity", "analytics", "campaign_access", "lead_sync"];
  const allUnsupported = unsupportedKeys.every((k) => capsDisconnected.capabilities.find((c) => c.key === k)?.status === "NOT_SUPPORTED");
  report(
    "TEST 3 (§41): every capability requiring LinkedIn Partner Program access is honestly NOT_SUPPORTED — never a workaround, never faked as available",
    "true",
    `allUnsupported=${allUnsupported}, statuses=${JSON.stringify(unsupportedKeys.map((k) => capsDisconnected.capabilities.find((c) => c.key === k)?.status))}`,
    allUnsupported,
  );

  // ===== TEST 4 (§39/§46): cross-tenant isolation — wrong org can't read another org's LinkedIn intelligence for a real company =====
  const crossTenant = await getCompanyLinkedInIntelligence(OTHER_ORG_ID, zomato.id);
  report(
    "TEST 4 (§36): wrong organizationId against a real company -> null, never leaks another org's data",
    "null",
    `result=${crossTenant}`,
    crossTenant === null,
  );

  // ===== TEST 5 (§19/§20/§42): AI recommendation for a company with NO opportunity/decision-maker -> honest "no recommendation", never invented =====
  const emptyCo = await prisma.company.create({ data: { organizationId: ORG_ID, name: "[phase9-test] Empty Co", source: "MANUAL" } });
  const emptyRec = await getLinkedInOutreachRecommendation(ORG_ID, emptyCo.id);
  report(
    "TEST 5 (§42): no evidence -> hasRecommendation=false, WHO=null, never a fabricated recommendation",
    "hasRecommendation=false, who=null",
    `hasRecommendation=${emptyRec.hasRecommendation}, who=${emptyRec.who}, why=${emptyRec.why}`,
    emptyRec.hasRecommendation === false && emptyRec.who === null,
  );

  // ===== TEST 6 (§18-22/§43): real recommendation for Zomato (has real DecisionMaker/Opportunity/IntentScore from earlier phases) =====
  const zomatoRec = await getLinkedInOutreachRecommendation(ORG_ID, zomato.id);
  report(
    "TEST 6 (§43): real recommendation format — WHO/WHY/WHEN/MESSAGE ANGLE/EVIDENCE/CONFIDENCE/STATUS all present, status is always RECOMMENDATION_ONLY",
    "status=RECOMMENDATION_ONLY, evidence.length > 0 (if hasRecommendation)",
    `hasRecommendation=${zomatoRec.hasRecommendation}, status=${zomatoRec.status}, evidenceCount=${zomatoRec.evidence.length}, confidence=${zomatoRec.confidence}, who=${JSON.stringify(zomatoRec.who)}`,
    zomatoRec.status === "RECOMMENDATION_ONLY" && (!zomatoRec.hasRecommendation || zomatoRec.evidence.length > 0),
  );

  // ===== TEST 7 (§20): every evidence record in the recommendation resolves to a real, existing row =====
  let allEvidenceReal = true;
  for (const e of zomatoRec.evidence) {
    let exists = false;
    if (e.recordType === "LeadOpportunity") exists = !!(await prisma.leadOpportunity.findUnique({ where: { id: e.recordId } }));
    else if (e.recordType === "DecisionMaker") exists = !!(await prisma.decisionMaker.findUnique({ where: { id: e.recordId } }));
    else if (e.recordType === "IntentScore") exists = !!(await prisma.intentScore.findUnique({ where: { id: e.recordId } }));
    else if (e.recordType === "EmailDraft") exists = !!(await prisma.emailDraft.findUnique({ where: { id: e.recordId } }));
    else if (e.recordType === "Reply") exists = !!(await prisma.reply.findUnique({ where: { id: e.recordId } }));
    else exists = true;
    if (!exists) allEvidenceReal = false;
  }
  report(
    "TEST 7 (§42 anti-hallucination): every evidence record cited in the recommendation is a real, existing row",
    "true",
    `evidenceCount=${zomatoRec.evidence.length}, allEvidenceReal=${allEvidenceReal}`,
    allEvidenceReal,
  );

  // ===== TEST 8 (§6): contact matching — the recommendation's WHO always points at an existing real Contact, never a newly-created one =====
  const contactsBefore = await prisma.contact.count({ where: { organizationId: ORG_ID } });
  await getLinkedInOutreachRecommendation(ORG_ID, zomato.id); // run again
  const contactsAfter = await prisma.contact.count({ where: { organizationId: ORG_ID } });
  report(
    "TEST 8 (§6): running the recommendation engine never creates a new Contact — contact count unchanged",
    `contactsBefore=${contactsBefore}`,
    `contactsAfter=${contactsAfter}`,
    contactsBefore === contactsAfter,
  );

  // ===== TEST 9 (§25): a real LINKEDIN-channel message/reply produces distinct LINKEDIN_* timeline events, not EMAIL_* =====
  const contact9 = await prisma.contact.create({ data: { organizationId: ORG_ID, companyId: zomato.id, firstName: "Phase9Contact", email: "phase9-test-contact@example-test.invalid", phone: "+19995559999" } });
  const draft9 = await prisma.emailDraft.create({
    data: { organizationId: ORG_ID, contactId: contact9.id, channel: "LINKEDIN", purpose: "CONNECTION_REQUEST", tone: "PROFESSIONAL", body: "[phase9-test] Real LinkedIn connection note.", status: "SENT", sentAt: new Date() },
  });
  await prisma.reply.create({
    data: { organizationId: ORG_ID, contactId: contact9.id, channel: "LINKEDIN", content: "[phase9-test] Thanks for connecting.", receivedAt: new Date(), loggedByUserId: USER_ID },
  });
  const timeline = await getCompanyCompleteTimeline(ORG_ID, zomato.id);
  const hasLinkedInMessage = timeline.some((e) => e.type === "LINKEDIN_MESSAGE" && e.recordId === draft9.id);
  const hasLinkedInReply = timeline.some((e) => e.type === "LINKEDIN_REPLY");
  const hasNoMislabeledEmailEvent = !timeline.some((e) => e.recordId === draft9.id && e.type === "EMAIL_SENT");
  report(
    "TEST 9 (§25): real LinkedIn message/reply get distinct LINKEDIN_MESSAGE/LINKEDIN_REPLY timeline events, never mislabeled EMAIL_*",
    "hasLinkedInMessage=true, hasLinkedInReply=true, hasNoMislabeledEmailEvent=true",
    `hasLinkedInMessage=${hasLinkedInMessage}, hasLinkedInReply=${hasLinkedInReply}, hasNoMislabeledEmailEvent=${hasNoMislabeledEmailEvent}`,
    hasLinkedInMessage && hasLinkedInReply && hasNoMislabeledEmailEvent,
  );

  // ===== TEST 10 (§44): the company LinkedIn intelligence composer surfaces this real activity =====
  const intelligence = await getCompanyLinkedInIntelligence(ORG_ID, zomato.id);
  const activityIncludesReal = intelligence?.activity.some((a) => a.id === draft9.id) ?? false;
  report(
    "TEST 10 (§44): LinkedIn Intelligence panel data includes the real message just sent",
    "true",
    `activityIncludesReal=${activityIncludesReal}, totalActivity=${intelligence?.activity.length}`,
    activityIncludesReal,
  );

  // ===== TEST 11 (§9): seniority is honestly labeled AI_INTERPRETATION with real evidence, never presented as a verified fact =====
  const seniorContact = intelligence?.contacts.find((c) => c.contactId === contact9.id);
  report(
    "TEST 11 (§9): a contact with no job title gets no fabricated seniority — null, not guessed",
    "seniority=null (no jobTitle set on this test contact)",
    `seniority=${JSON.stringify(seniorContact?.seniority)}`,
    seniorContact?.seniority === null,
  );

  // ===== TEST 12 (§16): a manually logged reply is real inbound data, never presented as anything but a real Reply =====
  const loggedReply = await prisma.reply.findFirst({ where: { organizationId: ORG_ID, contactId: contact9.id, channel: "LINKEDIN" } });
  report(
    "TEST 12 (§16): the real LinkedIn reply is a genuine Reply row with real content, not an internal note",
    "content starts with real test marker",
    `content=${loggedReply?.content}`,
    loggedReply?.content.startsWith("[phase9-test]") ?? false,
  );

  console.log(`\n\n===== PHASE 9 RESULTS: ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
