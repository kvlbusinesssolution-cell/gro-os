import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Canonical header name for every HMAC-signed outgoing webhook delivery —
// workflow-triggered (communication.ts) AND platform event-bus (event-bus.ts)
// deliveries both sign with this same header, so a receiver only ever needs
// one verification code path regardless of which system sent the request.
export const WEBHOOK_SIGNATURE_HEADER = "X-KVL-Signature";

/**
 * Generates a real, cryptographically random HMAC signing secret for a
 * Webhook row — 32 bytes of entropy, hex-encoded (64 chars), matching this
 * repo's other at-rest-secret conventions (e.g. ApiKey's raw key in
 * src/app/profile/actions.ts).
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * HMAC-SHA256 hex digest of `rawBody` keyed by `secret`. `rawBody` must be
 * the exact bytes that were (or will be) sent over the wire — signing a
 * re-serialized/re-parsed JSON object instead of the original raw request
 * body is a common source of signature mismatches and must be avoided by
 * callers.
 */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Timing-safe verification of a provided HMAC signature against the one
 * this server computes for `rawBody`. Never compares secrets/signatures with
 * plain `===`/string equality — that leaks timing information an attacker
 * can use to forge a valid signature byte-by-byte. `crypto.timingSafeEqual`
 * requires equal-length buffers, so a length mismatch (e.g. a malformed or
 * tampered signature) is treated as "not equal" rather than thrown.
 */
export function verifySignature(secret: string, rawBody: string, providedSignature: string): boolean {
  const expected = signPayload(secret, rawBody);

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
