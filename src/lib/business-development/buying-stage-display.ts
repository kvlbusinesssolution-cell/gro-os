import type { BuyingStage } from "@/generated/prisma/client";

/**
 * Phase 28 — shared display/validation helpers for the real BuyingStage
 * enum (see classifyBuyingStage in intent-scoring.ts). Kept here, not
 * duplicated per page, so Priority Queue / Watchlists / the company detail
 * panel all use the exact same real labels.
 */
export const BUYING_STAGE_VALUES: BuyingStage[] = [
  "UNKNOWN",
  "TARGET",
  "AWARENESS",
  "CONSIDERATION",
  "DECISION",
  "NEGOTIATION",
  "CUSTOMER",
  "LOST",
];

export const BUYING_STAGE_LABEL: Record<BuyingStage, string> = {
  UNKNOWN: "Unknown",
  TARGET: "Target",
  AWARENESS: "Awareness",
  CONSIDERATION: "Consideration",
  DECISION: "Decision",
  NEGOTIATION: "Negotiation",
  CUSTOMER: "Customer",
  LOST: "Lost",
};

export function isBuyingStage(value: string | undefined): value is BuyingStage {
  return !!value && (BUYING_STAGE_VALUES as string[]).includes(value);
}
