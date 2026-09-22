import { describe, expect, it } from "vitest";

import { classifyBuyerRole } from "./contact-classification";

describe("classifyBuyerRole", () => {
  it("classifies a CEO/Founder as economic buyer", () => {
    expect(classifyBuyerRole("Chief Executive Officer")).toBe("ECONOMIC_BUYER");
    expect(classifyBuyerRole("Founder")).toBe("ECONOMIC_BUYER");
    expect(classifyBuyerRole("CFO")).toBe("ECONOMIC_BUYER");
  });

  it("classifies a CTO/engineering head as technical buyer", () => {
    expect(classifyBuyerRole("CTO")).toBe("TECHNICAL_BUYER");
    expect(classifyBuyerRole("Head of Engineering")).toBe("TECHNICAL_BUYER");
  });

  it("classifies COO/VP Sales as business buyer", () => {
    expect(classifyBuyerRole("COO")).toBe("BUSINESS_BUYER");
    expect(classifyBuyerRole("VP Sales")).toBe("BUSINESS_BUYER");
  });

  it("classifies a generic director/VP as executive", () => {
    expect(classifyBuyerRole("Director of Operations")).toBe("EXECUTIVE");
  });

  it("classifies a manager/lead as influencer", () => {
    expect(classifyBuyerRole("Engineering Manager")).toBe("INFLUENCER");
  });

  it("returns UNKNOWN for an unrecognized or missing title, never a guess", () => {
    expect(classifyBuyerRole("Random Person")).toBe("UNKNOWN");
    expect(classifyBuyerRole(null)).toBe("UNKNOWN");
    expect(classifyBuyerRole(undefined)).toBe("UNKNOWN");
    expect(classifyBuyerRole("")).toBe("UNKNOWN");
  });
});
