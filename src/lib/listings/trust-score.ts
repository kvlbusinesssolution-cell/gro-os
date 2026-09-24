/**
 * Real, deterministic "Trust Score" for a public business listing —
 * JustDial-parity feature #3 ("Trust Stamp"), built honestly: every point
 * traces to a real, already-stored field on BusinessListing, never an
 * invented number. Zero AI, zero new schema/migration — pure computation
 * over data that already exists, so this is safe to call from any existing
 * render path without touching stored data at all.
 *
 * A listing with zero reviews never gets rating points (a 0.0 default
 * average is a real absence of data, not a real low rating) — same
 * "no signal should be treated as a fact" discipline this codebase already
 * applies elsewhere (see intent-scoring.ts).
 */

export interface TrustScoreInput {
  isVerified: boolean;
  averageRating: number;
  reviewCount: number;
  description: string | null;
  photoCount: number;
  phone: string | null;
  whatsappNumber: string | null;
  website: string | null;
  openingHours: unknown;
}

export interface TrustScoreFactor {
  label: string;
  points: number;
  maxPoints: number;
}

export type TrustScoreBand = "EXCELLENT" | "GOOD" | "FAIR" | "NEW";

export interface TrustScoreResult {
  score: number;
  band: TrustScoreBand;
  factors: TrustScoreFactor[];
}

const MIN_DESCRIPTION_LENGTH = 40;

function bandFor(score: number): TrustScoreBand {
  if (score >= 80) return "EXCELLENT";
  if (score >= 60) return "GOOD";
  if (score >= 35) return "FAIR";
  return "NEW";
}

export function computeTrustScore(listing: TrustScoreInput): TrustScoreResult {
  const factors: TrustScoreFactor[] = [];

  factors.push({ label: "Verified by platform", points: listing.isVerified ? 20 : 0, maxPoints: 20 });

  const ratingPoints = listing.reviewCount > 0 ? Math.round((listing.averageRating / 5) * 30) : 0;
  factors.push({ label: "Real customer rating", points: ratingPoints, maxPoints: 30 });

  let volumePoints = 0;
  if (listing.reviewCount >= 20) volumePoints = 15;
  else if (listing.reviewCount >= 5) volumePoints = 10;
  else if (listing.reviewCount >= 1) volumePoints = 5;
  factors.push({ label: "Review volume", points: volumePoints, maxPoints: 15 });

  let completenessPoints = 0;
  if ((listing.description ?? "").trim().length >= MIN_DESCRIPTION_LENGTH) completenessPoints += 5;
  if (listing.photoCount > 0) completenessPoints += 5;
  if (listing.openingHours) completenessPoints += 5;
  if (listing.phone || listing.whatsappNumber || listing.website) completenessPoints += 5;
  factors.push({ label: "Profile completeness", points: completenessPoints, maxPoints: 20 });

  const contactablePoints = listing.phone || listing.whatsappNumber ? 15 : 0;
  factors.push({ label: "Directly contactable", points: contactablePoints, maxPoints: 15 });

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { score, band: bandFor(score), factors };
}
