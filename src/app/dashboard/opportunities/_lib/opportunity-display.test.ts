import { describe, expect, it } from "vitest";

import type { DecisionMakerRole, OpportunityPriority } from "@/generated/prisma/client";

import type { QualityCheckResult } from "@/lib/outreach/personalization-quality";

import {
  confidenceBadgeClassName,
  DECISION_MAKER_ROLE_LABEL,
  PERSONALIZATION_CHECK_LABEL,
  personalizationCheckRows,
  PRIORITY_BADGE_CLASSNAME,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  recommendedNextAction,
  STATUS_LABEL,
  STATUS_OPTIONS,
} from "./opportunity-display";

describe("confidenceBadgeClassName", () => {
  it("returns the emerald (high-confidence) band at and above 80", () => {
    expect(confidenceBadgeClassName(80)).toContain("emerald");
    expect(confidenceBadgeClassName(100)).toContain("emerald");
  });

  it("returns the amber (mid-confidence) band from 50 up to 79", () => {
    expect(confidenceBadgeClassName(50)).toContain("amber");
    expect(confidenceBadgeClassName(79)).toContain("amber");
  });

  it("returns the red (low-confidence) band below 50", () => {
    expect(confidenceBadgeClassName(49)).toContain("red");
    expect(confidenceBadgeClassName(0)).toContain("red");
  });
});

describe("STATUS_LABEL", () => {
  it("has a label for every OpportunityStatus option", () => {
    for (const status of STATUS_OPTIONS) {
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
  });
});

describe("DECISION_MAKER_ROLE_LABEL", () => {
  const ALL_ROLES: DecisionMakerRole[] = [
    "FOUNDER",
    "CO_FOUNDER",
    "CEO",
    "DIRECTOR",
    "CTO",
    "COO",
    "MARKETING_HEAD",
    "SALES_HEAD",
    "BUSINESS_DEVELOPMENT_HEAD",
    "IT_HEAD",
    "PRODUCT_HEAD",
  ];

  it("has a non-empty, humanized label for every DecisionMakerRole", () => {
    for (const role of ALL_ROLES) {
      const label = DECISION_MAKER_ROLE_LABEL[role];
      expect(label).toBeTruthy();
      expect(label).not.toContain("_");
    }
  });

  it("humanizes multi-word roles with title-cased words", () => {
    expect(DECISION_MAKER_ROLE_LABEL.BUSINESS_DEVELOPMENT_HEAD).toBe("Business Development Head");
    expect(DECISION_MAKER_ROLE_LABEL.MARKETING_HEAD).toBe("Marketing Head");
  });
});

describe("PRIORITY_OPTIONS", () => {
  it("lists all 6 OpportunityPriority values, HOT first and DISQUALIFIED last", () => {
    const ALL_PRIORITIES: OpportunityPriority[] = ["HOT", "HIGH", "MEDIUM", "NURTURE", "LOW", "DISQUALIFIED"];
    expect(PRIORITY_OPTIONS).toEqual(ALL_PRIORITIES);
  });
});

describe("PRIORITY_LABEL", () => {
  it("has a non-empty label for every OpportunityPriority option", () => {
    for (const priority of PRIORITY_OPTIONS) {
      expect(PRIORITY_LABEL[priority]).toBeTruthy();
    }
  });

  it("has the expected human-readable label for each priority", () => {
    expect(PRIORITY_LABEL.HOT).toBe("Hot");
    expect(PRIORITY_LABEL.HIGH).toBe("High");
    expect(PRIORITY_LABEL.MEDIUM).toBe("Medium");
    expect(PRIORITY_LABEL.NURTURE).toBe("Nurture");
    expect(PRIORITY_LABEL.LOW).toBe("Low");
    expect(PRIORITY_LABEL.DISQUALIFIED).toBe("Disqualified");
  });
});

describe("PRIORITY_BADGE_CLASSNAME", () => {
  it("has a non-empty className for every OpportunityPriority option", () => {
    for (const priority of PRIORITY_OPTIONS) {
      expect(PRIORITY_BADGE_CLASSNAME[priority]).toBeTruthy();
    }
  });

  it("colors HOT as the most urgent (red) band", () => {
    expect(PRIORITY_BADGE_CLASSNAME.HOT).toContain("red");
  });

  it("colors DISQUALIFIED as muted/gray, matching the DISMISSED status treatment", () => {
    expect(PRIORITY_BADGE_CLASSNAME.DISQUALIFIED).toContain("muted");
  });

  it("gives every priority a distinct className", () => {
    const classNames = PRIORITY_OPTIONS.map((p) => PRIORITY_BADGE_CLASSNAME[p]);
    expect(new Set(classNames).size).toBe(classNames.length);
  });
});

describe("recommendedNextAction", () => {
  it("prefers a populated nextStep over any derived fallback", () => {
    expect(
      recommendedNextAction({ status: "NEW", nextStep: "Call the CTO about the outdated checkout flow", recommendedServiceLabel: "CRM" }),
    ).toBe("Call the CTO about the outdated checkout flow");
  });

  it("ignores a blank/whitespace-only nextStep and falls back", () => {
    expect(recommendedNextAction({ status: "NEW", nextStep: "   ", recommendedServiceLabel: null })).toBe("Review and triage");
  });

  it("says dismissed opportunities need no action, regardless of service", () => {
    expect(recommendedNextAction({ status: "DISMISSED", nextStep: null, recommendedServiceLabel: "CRM" })).toBe(
      "No action — dismissed",
    );
  });

  it("points ADDED_TO_CRM opportunities to follow up in the CRM", () => {
    expect(recommendedNextAction({ status: "ADDED_TO_CRM", nextStep: null, recommendedServiceLabel: null })).toBe(
      "Already in CRM — follow up there",
    );
  });

  it("tells NEW opportunities to review/triage when there's no matched service", () => {
    expect(recommendedNextAction({ status: "NEW", nextStep: null, recommendedServiceLabel: null })).toBe("Review and triage");
  });

  it("tells NEW opportunities to pitch the matched service when one exists", () => {
    expect(recommendedNextAction({ status: "NEW", nextStep: null, recommendedServiceLabel: "Website Development" })).toBe(
      "Review and pitch Website Development",
    );
  });

  it("tells REVIEWED opportunities to pitch the matched service when one exists", () => {
    expect(recommendedNextAction({ status: "REVIEWED", nextStep: null, recommendedServiceLabel: "CRM" })).toBe("Pitch CRM");
  });

  it("tells REVIEWED opportunities with no matched service to move to CRM or dismiss", () => {
    expect(recommendedNextAction({ status: "REVIEWED", nextStep: null, recommendedServiceLabel: null })).toBe(
      "Move to CRM or dismiss",
    );
  });
});

describe("personalizationCheckRows", () => {
  const ALL_PASSED: QualityCheckResult["checkedFields"] = {
    companyName: true,
    personName: true,
    companyFacts: true,
    opportunity: true,
    service: true,
    evidence: true,
  };

  it("returns one row per checked field, in PERSONALIZATION_CHECK_LABEL's declared order", () => {
    const rows = personalizationCheckRows(ALL_PASSED);
    expect(rows.map((r) => r.key)).toEqual(Object.keys(PERSONALIZATION_CHECK_LABEL));
  });

  it("carries through each field's non-empty label and pass/fail state", () => {
    const rows = personalizationCheckRows({ ...ALL_PASSED, personName: false, service: false });
    for (const row of rows) {
      expect(row.label).toBe(PERSONALIZATION_CHECK_LABEL[row.key]);
      expect(row.label).toBeTruthy();
    }
    expect(rows.find((r) => r.key === "personName")?.passed).toBe(false);
    expect(rows.find((r) => r.key === "service")?.passed).toBe(false);
    expect(rows.find((r) => r.key === "companyName")?.passed).toBe(true);
  });

  it("keeps row order stable regardless of the input object's own key order", () => {
    const reordered: QualityCheckResult["checkedFields"] = {
      evidence: true,
      service: true,
      opportunity: true,
      companyFacts: true,
      personName: true,
      companyName: true,
    };
    expect(personalizationCheckRows(reordered).map((r) => r.key)).toEqual(Object.keys(PERSONALIZATION_CHECK_LABEL));
  });
});
