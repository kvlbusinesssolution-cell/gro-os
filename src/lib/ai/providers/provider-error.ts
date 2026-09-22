/**
 * Phase 26 (real, minimal provider-state fix — distinguish RATE_LIMITED
 * from FAILED, honor a real Retry-After header when a provider sends one).
 * Deliberately small: this is NOT a persisted provider-health system or a
 * live health dashboard — those are Phase 27's explicit "provider health
 * monitoring" scope. This is just carrying the real HTTP status and
 * Retry-After value that was already available at the fetch call site up
 * to fallback.ts's cooldown logic, instead of discarding it into a plain
 * error-message string.
 */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Parsed from a real `Retry-After` response header, in milliseconds. Null when the provider didn't send one (or sent a non-numeric value this doesn't attempt to parse as an HTTP-date). */
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** A real `Retry-After` header is either a whole number of seconds, or an HTTP-date. Only the numeric-seconds form is parsed here — an HTTP-date Retry-After is rare in practice for these providers and honestly falling back to the flat cooldown for that case is simpler and safer than a date-parsing edge case. */
export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

/**
 * Duck-types across this codebase's own `ProviderHttpError` (fetch-based
 * providers) and the real Anthropic SDK's `APIError` (which has its own
 * real `.status` and `.headers`, confirmed via the SDK's own type
 * definitions) — a single place both real error shapes are read from,
 * rather than fallback.ts needing to know about SDK internals.
 */
export function classifyProviderError(error: unknown): { status: number | null; retryAfterMs: number | null } {
  if (error instanceof ProviderHttpError) {
    return { status: error.status, retryAfterMs: error.retryAfterMs };
  }
  if (error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number") {
    const status = (error as { status: number }).status;
    const headers = (error as { headers?: unknown }).headers;
    let retryAfterMs: number | null = null;
    if (headers && typeof headers === "object" && "get" in headers && typeof (headers as { get: unknown }).get === "function") {
      retryAfterMs = parseRetryAfterMs((headers as { get: (name: string) => string | null }).get("retry-after"));
    }
    return { status, retryAfterMs };
  }
  // Fetch-based providers that haven't been migrated to throw
  // ProviderHttpError yet (or any other error shape) still carry the
  // status in their message string ("HTTP 429 from ...") from before this
  // fix — a real, honest fallback, never guessed beyond what's in the text.
  const message = error instanceof Error ? error.message : String(error);
  const match = /^HTTP (\d{3}) from/.exec(message);
  return { status: match ? Number(match[1]) : null, retryAfterMs: null };
}
