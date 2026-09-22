/**
 * Phase 27 (real gap, confirmed by audit: zero AbortController/fetch-timeout
 * anywhere across the provider adapters — a hung provider call could block
 * indefinitely). 90s, not this codebase's usual few-seconds convention for
 * quick metadata lookups (see e.g. src/lib/security/ip-reputation.ts's 3s) —
 * a real LLM generation call, especially with web search or higher effort,
 * genuinely can take significantly longer than a plain HTTP request. Long
 * enough that a real, slow-but-working generation isn't cut off; short
 * enough that a genuinely hung request still falls through to the next
 * provider in the chain within a bounded, user-tolerable time.
 */
export const PROVIDER_TIMEOUT_MS = 90_000;
