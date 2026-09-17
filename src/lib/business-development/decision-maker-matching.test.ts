import { describe, expect, it } from "vitest";

import { matchDecisionMakerForOpportunity, type DecisionMakerCandidate } from "./decision-maker-matching";

// Pure-function tests — no Prisma, no dotenv, no AI call. Mirrors
// discovery-buckets.test.ts's "pure logic, isolated" style.
describe("matchDecisionMakerForOpportunity", () => {
  it("returns null when there are zero decision-maker candidates", () => {
    expect(matchDecisionMakerForOpportunity("SAAS_DEVELOPMENT", [])).toBeNull();
  });

  it("picks the top-tier role for SAAS_DEVELOPMENT (CTO first)", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Ada Lovelace", role: "CTO", source: "Company website /about page", sourceUrl: null, confidence: 0.9 },
      { id: "2", name: "Grace Hopper", role: "SALES_HEAD", source: "Public LinkedIn profile snippet", sourceUrl: null, confidence: 0.9 },
    ];
    const match = matchDecisionMakerForOpportunity("SAAS_DEVELOPMENT", candidates);
    expect(match).not.toBeNull();
    expect(match?.decisionMaker.id).toBe("1");
    expect(match?.whyThisPerson).toContain("top-priority");
    expect(match?.whyThisPerson).toContain("SaaS Development");
  });

  it("picks the top-tier role for CRM (COO first)", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Person COO", role: "COO", source: "Press release mention", sourceUrl: null, confidence: 0.6 },
      { id: "2", name: "Person CTO", role: "CTO", source: "Company website /about page", sourceUrl: null, confidence: 0.6 },
    ];
    const match = matchDecisionMakerForOpportunity("CRM", candidates);
    expect(match?.decisionMaker.id).toBe("1");
  });

  it("picks the top-tier role for ERP (COO first)", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Person IT Head", role: "IT_HEAD", source: "Company website /about page", sourceUrl: null, confidence: 0.7 },
      { id: "2", name: "Person COO", role: "COO", source: "Company website /about page", sourceUrl: null, confidence: 0.7 },
    ];
    const match = matchDecisionMakerForOpportunity("ERP", candidates);
    expect(match?.decisionMaker.id).toBe("2");
  });

  it("picks the top-tier role for WHATSAPP_AUTOMATION (COO first)", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Person Sales Head", role: "SALES_HEAD", source: "Public LinkedIn profile snippet", sourceUrl: null, confidence: 0.8 },
      { id: "2", name: "Person COO", role: "COO", source: "Public LinkedIn profile snippet", sourceUrl: null, confidence: 0.8 },
    ];
    const match = matchDecisionMakerForOpportunity("WHATSAPP_AUTOMATION", candidates);
    expect(match?.decisionMaker.id).toBe("2");
  });

  it("blends role-relevance and identity confidence — a lower-tier role with much higher confidence can still win", () => {
    const candidates: DecisionMakerCandidate[] = [
      // Top-tier role (CTO, 100) but very low identity confidence: (100 + 5) / 2 = 52.5
      { id: "1", name: "Shaky CTO", role: "CTO", source: "A single unverified mention", sourceUrl: null, confidence: 0.05 },
      // Not-listed role (10) but very high identity confidence: (10 + 100) / 2 = 55
      { id: "2", name: "Verified CEO", role: "CEO", source: "Company website /about page", sourceUrl: null, confidence: 1.0 },
    ];
    const match = matchDecisionMakerForOpportunity("SAAS_DEVELOPMENT", candidates);
    expect(match?.decisionMaker.id).toBe("2");
    expect(match?.relevanceScore).toBe(55);
  });

  it("computes relevanceScore as the documented 50/50 average", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Solo Candidate", role: "CTO", source: "Company website /about page", sourceUrl: null, confidence: 0.85 },
    ];
    const match = matchDecisionMakerForOpportunity("SAAS_DEVELOPMENT", candidates);
    // role relevance for 1st-tier = 100, confidence 85 -> (100 + 85) / 2 = 92.5 -> rounds to 93
    expect(match?.relevanceScore).toBe(93);
  });

  it("falls back to a non-zero baseline score for an unmapped/null service, without crashing", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "1", name: "Someone", role: "DIRECTOR", source: "Press release mention", sourceUrl: null, confidence: 0.5 },
    ];
    const match = matchDecisionMakerForOpportunity(null, candidates);
    expect(match).not.toBeNull();
    // (10 + 50) / 2 = 30
    expect(match?.relevanceScore).toBe(30);
    expect(match?.whyThisPerson.length).toBeGreaterThan(0);
  });

  it("the highest-scoring person wins among several real candidates", () => {
    const candidates: DecisionMakerCandidate[] = [
      { id: "low", name: "Low Match", role: "IT_HEAD", source: "Press mention", sourceUrl: null, confidence: 0.3 },
      { id: "mid", name: "Mid Match", role: "PRODUCT_HEAD", source: "Company website /about page", sourceUrl: null, confidence: 0.6 },
      { id: "high", name: "High Match", role: "CTO", source: "Public LinkedIn profile snippet", sourceUrl: "https://linkedin.com/in/high-match", confidence: 0.95 },
    ];
    const match = matchDecisionMakerForOpportunity("MOBILE_APP_DEVELOPMENT", candidates);
    expect(match?.decisionMaker.id).toBe("high");
  });
});
