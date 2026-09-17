import "dotenv/config";

import { describe, expect, it } from "vitest";

import { isAIConnected } from "@/lib/ai/client";
import type { AcquisitionOverview } from "@/lib/analytics/acquisition-funnel";

import { getAcquisitionInsights } from "./acquisition-insights";

// Real, hand-built fixture — this function narrates an already-computed
// AcquisitionOverview, it never queries Prisma itself, so a plain in-memory
// object is the correct (and correctly scoped) input for testing it. Numbers
// are deliberately distinctive: WEBSITE_SCANNER is the clear revenue leader
// (3 won deals, $8,000 — every other source has 0 won deals/revenue), and
// the Healthcare industry has companies but zero conversions.
const FIXTURE_OVERVIEW: AcquisitionOverview = {
  funnel: [
    { stage: "Companies", count: 40 },
    { stage: "Qualified Leads", count: 20 },
    { stage: "Opportunities", count: 15 },
    { stage: "Contacts", count: 30 },
    { stage: "Outreach Sent", count: 25 },
    { stage: "Replies", count: 10 },
    { stage: "Meetings", count: 5 },
    { stage: "Proposals", count: 4 },
    { stage: "Won Deals", count: 3 },
  ],
  totalRevenue: 8000,
  bySource: [
    { source: "MANUAL", companies: 5, qualifiedLeads: 2, opportunities: 1, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
    { source: "LEAD_FINDER", companies: 8, qualifiedLeads: 3, opportunities: 2, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
    { source: "CLIENT_FINDER", companies: 4, qualifiedLeads: 1, opportunities: 1, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
    { source: "WEBSITE_SCANNER", companies: 10, qualifiedLeads: 8, opportunities: 6, meetings: 3, proposals: 2, wonDeals: 3, revenue: 8000 },
    { source: "AUTO_DISCOVERY", companies: 10, qualifiedLeads: 5, opportunities: 4, meetings: 2, proposals: 2, wonDeals: 0, revenue: 0 },
    { source: "REFERRAL", companies: 3, qualifiedLeads: 1, opportunities: 1, meetings: 0, proposals: 0, wonDeals: 0, revenue: 0 },
  ],
  byIndustry: [
    { industry: "Healthcare", companies: 12, wonDeals: 0, revenue: 0 },
    { industry: "Technology", companies: 15, wonDeals: 3, revenue: 8000 },
    { industry: "Retail", companies: 13, wonDeals: 0, revenue: 0 },
  ],
  byCountry: [
    { country: "United Arab Emirates", companies: 25, wonDeals: 3, revenue: 8000 },
    { country: "Saudi Arabia", companies: 15, wonDeals: 0, revenue: 0 },
  ],
  byService: [
    { service: "SEO Audit", opportunities: 6, wonDeals: 3, revenue: 8000 },
    { service: "Brand Strategy", opportunities: 5, wonDeals: 0, revenue: 0 },
    { service: "Paid Media", opportunities: 4, wonDeals: 0, revenue: 0 },
  ],
  byCampaign: [
    { campaignId: "camp-1", campaignName: "Q1 Outreach", contactsEnrolled: 12, emailsSent: 10, replies: 4, meetings: 3, wonDeals: 3, revenue: 8000 },
  ],
};

const ZERO_COMPANIES_OVERVIEW: AcquisitionOverview = {
  funnel: [
    { stage: "Companies", count: 0 },
    { stage: "Qualified Leads", count: 0 },
    { stage: "Opportunities", count: 0 },
    { stage: "Contacts", count: 0 },
    { stage: "Outreach Sent", count: 0 },
    { stage: "Replies", count: 0 },
    { stage: "Meetings", count: 0 },
    { stage: "Proposals", count: 0 },
    { stage: "Won Deals", count: 0 },
  ],
  totalRevenue: 0,
  bySource: [],
  byIndustry: [],
  byCountry: [],
  byService: [],
  byCampaign: [],
};

describe("getAcquisitionInsights", () => {
  it("returns an honest empty-state message when there are zero companies, never a fabricated insight about zero data", async () => {
    const result = await getAcquisitionInsights("org_1", ZERO_COMPANIES_OVERVIEW);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]).toMatch(/not enough data yet/i);
  });

  it("returns real, grounded insights citing an actual number from the fixture when AI is connected", async () => {
    // Real AI provider round-trip — needs a longer timeout than vitest's 5s default.
    if (!isAIConnected()) {
      console.warn("[acquisition-insights.test] No AI provider configured in this environment — skipping AI-dependent assertions.");
      return;
    }

    const result = await getAcquisitionInsights("org_1", FIXTURE_OVERVIEW);

    expect(Array.isArray(result.insights)).toBe(true);
    expect(result.insights.length).toBeGreaterThanOrEqual(1);
    expect(result.insights.length).toBeLessThanOrEqual(5);

    // Strongest anti-hallucination check: at least one insight must cite a
    // real number that is actually present in the fixture — here, the
    // WEBSITE_SCANNER source's $8,000 revenue (the fixture's most
    // distinctive, unambiguous figure; every other source shows $0).
    const combined = result.insights.join(" \n ");
    expect(combined).toMatch(/8,?000/);
  }, 30_000);

  it("returns an empty array (not an error) when no AI provider is configured", async () => {
    // Mirrors the established technique in this repo's AI-dependent tests
    // (e.g. business-development/opportunity-engine.test.ts,
    // website-intelligence.test.ts) of gating on the real isAIConnected()
    // check — here we drive that check to false directly, since
    // isAIConnected() is a plain env-var read (src/lib/ai/client.ts), by
    // temporarily clearing every provider key it looks at for the duration
    // of this one test and restoring them immediately after.
    const keys = ["ANTHROPIC_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"] as const;
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    try {
      expect(isAIConnected()).toBe(false);
      const result = await getAcquisitionInsights("org_1", FIXTURE_OVERVIEW);
      expect(result).toEqual({ insights: [] });
    } finally {
      for (const key of keys) {
        if (saved[key] !== undefined) process.env[key] = saved[key];
      }
    }
  });
});
