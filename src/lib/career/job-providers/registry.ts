import { createRemotiveProvider } from "./remotive";
import type { JobProvider } from "./types";

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real provider
 * registry (§4). Deliberately lists only ONE real, verified provider —
 * adding a second entry here just to look more complete without a real,
 * working, authorized integration behind it would violate §4's own rule
 * ("do not claim a provider is active unless actual configuration/evidence
 * exists") and §46 ("no fake provider responses").
 */
export function getJobProviders(): JobProvider[] {
  return [createRemotiveProvider()];
}

export function getJobProviderByName(name: string): JobProvider | null {
  return getJobProviders().find((p) => p.name === name) ?? null;
}
