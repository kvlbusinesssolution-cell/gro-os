import { describe, expect, it } from "vitest";

import type { PartnerType, ReferralPartnerStatus } from "@/generated/prisma/client";

import {
  aggregateReferralPartnerStats,
  formatCommissionRate,
  PARTNER_STATUS_BADGE_CLASSNAME,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_OPTIONS,
  PARTNER_TYPE_LABEL,
  PARTNER_TYPE_OPTIONS,
  partnerTypeLabel,
} from "./referral-partner-display";

const ALL_TYPES: PartnerType[] = [
  "FREELANCER",
  "DIGITAL_AGENCY",
  "SEO_AGENCY",
  "MARKETING_CONSULTANT",
  "IT_CONSULTANT",
  "BUSINESS_CONSULTANT",
  "DESIGNER",
  "TECHNOLOGY_CONSULTANT",
];

const ALL_STATUSES: ReferralPartnerStatus[] = ["CANDIDATE", "ACTIVE", "INACTIVE"];

describe("PARTNER_TYPE_LABEL / PARTNER_TYPE_OPTIONS", () => {
  it("has a label for every PartnerType option", () => {
    for (const type of PARTNER_TYPE_OPTIONS) {
      expect(PARTNER_TYPE_LABEL[type]).toBeTruthy();
    }
  });

  it("lists every PartnerType value exactly once", () => {
    expect(new Set(PARTNER_TYPE_OPTIONS)).toEqual(new Set(ALL_TYPES));
    expect(PARTNER_TYPE_OPTIONS).toHaveLength(ALL_TYPES.length);
  });
});

describe("partnerTypeLabel", () => {
  it("humanizes every real PartnerType", () => {
    expect(partnerTypeLabel("DIGITAL_AGENCY")).toBe("Digital Agency");
    expect(partnerTypeLabel("SEO_AGENCY")).toBe("SEO Agency");
  });

  it("falls back to Unspecified for a null type rather than guessing one", () => {
    expect(partnerTypeLabel(null)).toBe("Unspecified");
  });
});

describe("PARTNER_STATUS_LABEL / PARTNER_STATUS_OPTIONS", () => {
  it("has a label for every ReferralPartnerStatus option", () => {
    for (const status of PARTNER_STATUS_OPTIONS) {
      expect(PARTNER_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("lists every ReferralPartnerStatus value exactly once", () => {
    expect(new Set(PARTNER_STATUS_OPTIONS)).toEqual(new Set(ALL_STATUSES));
  });
});

describe("PARTNER_STATUS_BADGE_CLASSNAME", () => {
  it("gives CANDIDATE a muted treatment distinct from ACTIVE", () => {
    expect(PARTNER_STATUS_BADGE_CLASSNAME.CANDIDATE).toContain("muted");
    expect(PARTNER_STATUS_BADGE_CLASSNAME.ACTIVE).toContain("emerald");
    expect(PARTNER_STATUS_BADGE_CLASSNAME.CANDIDATE).not.toBe(PARTNER_STATUS_BADGE_CLASSNAME.ACTIVE);
  });

  it("gives INACTIVE its own band distinct from CANDIDATE", () => {
    expect(PARTNER_STATUS_BADGE_CLASSNAME.INACTIVE).not.toBe(PARTNER_STATUS_BADGE_CLASSNAME.CANDIDATE);
  });
});

describe("formatCommissionRate", () => {
  it("renders the real stored percent with a % suffix", () => {
    expect(formatCommissionRate(10)).toBe("10%");
    expect(formatCommissionRate(12.5)).toBe("12.5%");
  });
});

describe("aggregateReferralPartnerStats", () => {
  it("computes every real total from the referred-companies/deals/commissions relation chain", () => {
    const stats = aggregateReferralPartnerStats({
      companies: [
        { leads: [{ id: "l1" }, { id: "l2" }], deals: [{ value: 1000 }, { value: null }] },
        { leads: [{ id: "l3" }], deals: [{ value: 500 }] },
      ],
      commissions: [
        { amount: 100, status: "PENDING" },
        { amount: 50, status: "PAID" },
        { amount: 25, status: "PAID" },
      ],
    });

    expect(stats.companiesReferred).toBe(2);
    expect(stats.leadsReferred).toBe(3);
    expect(stats.dealsCount).toBe(3);
    // 1000 + 0 (null deal contributes nothing) + 500
    expect(stats.revenue).toBe(1500);
    expect(stats.commissionTotal).toBe(175);
    expect(stats.pendingPayout).toBe(100);
    expect(stats.paidPayout).toBe(75);
  });

  it("returns all zeros for a partner with no referred companies or commissions", () => {
    const stats = aggregateReferralPartnerStats({ companies: [], commissions: [] });
    expect(stats).toEqual({
      companiesReferred: 0,
      leadsReferred: 0,
      dealsCount: 0,
      revenue: 0,
      commissionTotal: 0,
      pendingPayout: 0,
      paidPayout: 0,
    });
  });
});
