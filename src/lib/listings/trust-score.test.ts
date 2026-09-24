import { describe, expect, it } from "vitest";

import { computeTrustScore } from "./trust-score";

const BASE = {
  isVerified: false,
  averageRating: 0,
  reviewCount: 0,
  description: null,
  photoCount: 0,
  phone: null,
  whatsappNumber: null,
  website: null,
  openingHours: null,
};

describe("trust-score.ts — computeTrustScore", () => {
  it("gives a brand-new, empty listing a score of 0 and band NEW", () => {
    const result = computeTrustScore(BASE);
    expect(result.score).toBe(0);
    expect(result.band).toBe("NEW");
  });

  it("never awards rating points for a 0.0 default average with zero reviews", () => {
    const result = computeTrustScore({ ...BASE, averageRating: 0, reviewCount: 0 });
    const ratingFactor = result.factors.find((f) => f.label === "Real customer rating");
    expect(ratingFactor?.points).toBe(0);
  });

  it("awards full rating points for a real perfect average with reviews on file", () => {
    const result = computeTrustScore({ ...BASE, averageRating: 5, reviewCount: 3 });
    const ratingFactor = result.factors.find((f) => f.label === "Real customer rating");
    expect(ratingFactor?.points).toBe(30);
  });

  it("tiers review-volume points by real review count", () => {
    expect(computeTrustScore({ ...BASE, reviewCount: 0 }).factors.find((f) => f.label === "Review volume")?.points).toBe(0);
    expect(computeTrustScore({ ...BASE, reviewCount: 2 }).factors.find((f) => f.label === "Review volume")?.points).toBe(5);
    expect(computeTrustScore({ ...BASE, reviewCount: 10 }).factors.find((f) => f.label === "Review volume")?.points).toBe(10);
    expect(computeTrustScore({ ...BASE, reviewCount: 25 }).factors.find((f) => f.label === "Review volume")?.points).toBe(15);
  });

  it("awards profile-completeness points only for real, substantial data", () => {
    const shortDescription = computeTrustScore({ ...BASE, description: "Too short" });
    expect(shortDescription.factors.find((f) => f.label === "Profile completeness")?.points).toBe(0);

    const fullProfile = computeTrustScore({
      ...BASE,
      description: "A real, detailed description of the business that is definitely long enough.",
      photoCount: 3,
      openingHours: { mon: { open: "09:00", close: "18:00", closed: false } },
      phone: "+911234567890",
    });
    expect(fullProfile.factors.find((f) => f.label === "Profile completeness")?.points).toBe(20);
  });

  it("awards contactability points only when phone or WhatsApp is real", () => {
    expect(computeTrustScore({ ...BASE, website: "https://acme.com" }).factors.find((f) => f.label === "Directly contactable")?.points).toBe(0);
    expect(computeTrustScore({ ...BASE, phone: "+911234567890" }).factors.find((f) => f.label === "Directly contactable")?.points).toBe(15);
  });

  it("reaches EXCELLENT band for a fully verified, well-reviewed, complete listing", () => {
    const result = computeTrustScore({
      isVerified: true,
      averageRating: 4.8,
      reviewCount: 25,
      description: "A real, detailed description of the business that is definitely long enough.",
      photoCount: 5,
      phone: "+911234567890",
      whatsappNumber: "+911234567890",
      website: "https://acme.com",
      openingHours: { mon: { open: "09:00", close: "18:00", closed: false } },
    });
    expect(result.band).toBe("EXCELLENT");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("every factor's points never exceed its own maxPoints", () => {
    const result = computeTrustScore({
      isVerified: true,
      averageRating: 5,
      reviewCount: 100,
      description: "A".repeat(500),
      photoCount: 50,
      phone: "+911234567890",
      whatsappNumber: "+911234567890",
      website: "https://acme.com",
      openingHours: {},
    });
    for (const factor of result.factors) {
      expect(factor.points).toBeLessThanOrEqual(factor.maxPoints);
    }
    expect(result.score).toBe(100);
  });
});
