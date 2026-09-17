import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { checkDraftPersonalizationQuality } from "./personalization-quality";

// Real local-Postgres integration test (no mocking, matching the rest of
// this repo's Prisma-touching code) — everything scoped under one throwaway
// Organization created here and deleted in afterAll.
describe("checkDraftPersonalizationQuality", () => {
  let orgId: string;
  let userId: string;

  // (a) a draft genuinely grounded in real data — should pass every check.
  let goodCompanyId: string;
  let goodContactId: string;
  let goodDraftId: string;
  const evidenceFact =
    "Zenith Robotics Labs' homepage has not been redesigned since 2019 and scores 38 out of 100 on Lighthouse mobile performance audits.";

  // (b) a generic draft referencing none of it — should fail every check.
  let genericCompanyId: string;
  let genericContactId: string;
  let genericDraftId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Personalization Quality Test Org", slug: `pq-test-org-${suffix}` },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: { name: "PQ Test User", email: `pq-test-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    // ----- (a) real, well-grounded fixture -----
    const goodCompany = await prisma.company.create({
      data: { organizationId: orgId, name: "Zenith Robotics Labs", status: "PROSPECT" },
    });
    goodCompanyId = goodCompany.id;

    const goodContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: goodCompanyId, firstName: "Priya", lastName: "Nair", email: `priya-${suffix}@example.com` },
    });
    goodContactId = goodContact.id;

    await prisma.companyEvidence.create({
      data: { companyId: goodCompanyId, kind: "RAW_FACT", fact: evidenceFact, source: "WEBSITE_SCAN", confidence: 0.9 },
    });

    await prisma.leadOpportunity.create({
      data: {
        companyId: goodCompanyId,
        category: "Website",
        title: "Outdated, slow website",
        description: "Public site is stale and scores poorly on mobile performance.",
        estimatedImpact: "High",
        evidence: evidenceFact,
        confidenceScore: 85,
        recommendedService: "WEBSITE_DEVELOPMENT",
        status: "NEW",
      },
    });

    const goodDraft = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: goodContactId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Quick note on Zenith Robotics Labs' website",
        body: [
          "Hi Priya,",
          "",
          "I noticed Zenith Robotics Labs' homepage has not been redesigned since 2019 and scores 38 out of 100 on Lighthouse mobile performance audits.",
          "We specialize in Website Development for teams like yours and could help turn that around.",
          "",
          "Worth a quick chat?",
        ].join("\n"),
        status: "DRAFT",
      },
    });
    goodDraftId = goodDraft.id;

    // ----- (b) generic, ungrounded fixture -----
    const genericCompany = await prisma.company.create({
      data: { organizationId: orgId, name: "Unrelated Widgets Inc", status: "PROSPECT" },
    });
    genericCompanyId = genericCompany.id;

    const genericContact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: genericCompanyId, firstName: "Alex", email: `alex-${suffix}@example.com` },
    });
    genericContactId = genericContact.id;

    const genericDraft = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: genericContactId,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: "Quick question",
        body: ["Hi Team,", "", "I wanted to reach out about our services. Let me know if you're interested.", "", "Best regards."].join("\n"),
        status: "DRAFT",
      },
    });
    genericDraftId = genericDraft.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });

    const remainingDrafts = await prisma.emailDraft.count({ where: { organizationId: orgId } });
    expect(remainingDrafts).toBe(0);
  });

  it("passes every check for a draft genuinely grounded in real company/contact/opportunity/evidence data", async () => {
    const result = await checkDraftPersonalizationQuality(goodDraftId);

    expect(result.checkedFields).toEqual({
      companyName: true,
      personName: true,
      companyFacts: true,
      opportunity: true,
      service: true,
      evidence: true,
    });
    expect(result.issues).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("fails every applicable check, with real specific issues, for a generic ungrounded draft", async () => {
    const result = await checkDraftPersonalizationQuality(genericDraftId);

    expect(result.checkedFields.companyName).toBe(false);
    expect(result.checkedFields.personName).toBe(false);
    expect(result.checkedFields.companyFacts).toBe(false);
    expect(result.checkedFields.opportunity).toBe(false);
    expect(result.checkedFields.evidence).toBe(false);
    // No recommendedService exists at all for this company (no opportunity),
    // so `service` is vacuously not-applicable/true — only the five other
    // fields are expected to genuinely fail here.
    expect(result.checkedFields.service).toBe(true);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(5);
    expect(result.issues).toContain("Draft does not mention the company's real name.");
    expect(result.issues).toContain("Draft does not mention the contact's real first name.");
    expect(result.issues.some((issue) => issue.includes("real researched company fact"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("LeadOpportunity"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("CompanyEvidence"))).toBe(true);
  });

  it("service check fails honestly when the draft has an opportunity with a recommendedService that is never mentioned", async () => {
    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Service Mismatch Co", status: "PROSPECT" },
    });
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Sam", email: `sam-${Date.now()}@example.com` },
    });
    await prisma.leadOpportunity.create({
      data: {
        companyId: company.id,
        category: "CRM",
        title: "No CRM in place",
        description: "Sales team tracks leads in spreadsheets.",
        estimatedImpact: "Medium",
        evidence: "n/a",
        confidenceScore: 60,
        recommendedService: "CRM",
        status: "NEW",
      },
    });
    const draft = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        body: `Hi Sam, reaching out from ${company.name} land — just a generic note that never names the recommended service.`,
        status: "DRAFT",
      },
    });

    const result = await checkDraftPersonalizationQuality(draft.id);
    expect(result.checkedFields.service).toBe(false);
    expect(result.issues.some((issue) => issue.includes("recommended service"))).toBe(true);

    await prisma.emailDraft.delete({ where: { id: draft.id } });
  });
});
