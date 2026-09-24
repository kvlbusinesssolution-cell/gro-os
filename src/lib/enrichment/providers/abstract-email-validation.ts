/**
 * Abstract API — Email Validation (https://www.abstractapi.com/api/email-verification-validation-api).
 * Platform-level, env-var-configured (ABSTRACT_EMAIL_API_KEY) — the second
 * step of the email-verification waterfall (src/lib/enrichment/
 * email-waterfall.ts), tried when Hunter.io is unconfigured or its monthly
 * quota is exhausted. Real free tier: 100 requests/month.
 */

const ABSTRACT_BASE = "https://emailvalidation.abstractapi.com/v1/";

export function isAbstractEmailConfigured(): boolean {
  return Boolean(process.env.ABSTRACT_EMAIL_API_KEY?.trim());
}

export type AbstractDeliverability = "DELIVERABLE" | "UNDELIVERABLE" | "RISKY" | "UNKNOWN";

export interface AbstractEmailValidation {
  ok: boolean;
  deliverability?: AbstractDeliverability;
  qualityScore?: number;
  isDisposable?: boolean;
  isFreeEmail?: boolean;
  isRoleEmail?: boolean;
  error?: string;
}

interface AbstractResponse {
  deliverability?: AbstractDeliverability;
  quality_score?: string;
  is_disposable_email?: { value?: boolean };
  is_free_email?: { value?: boolean };
  is_role_email?: { value?: boolean };
  error?: { message?: string };
}

export async function abstractValidateEmail(email: string): Promise<AbstractEmailValidation> {
  const apiKey = process.env.ABSTRACT_EMAIL_API_KEY;
  if (!apiKey) return { ok: false, error: "ABSTRACT_EMAIL_API_KEY not configured" };

  try {
    const params = new URLSearchParams({ api_key: apiKey, email });
    const response = await fetch(`${ABSTRACT_BASE}?${params.toString()}`);
    const body = (await response.json().catch(() => ({}))) as AbstractResponse;
    if (!response.ok) return { ok: false, error: body.error?.message ?? `HTTP ${response.status}` };
    return {
      ok: true,
      deliverability: body.deliverability,
      qualityScore: body.quality_score ? Number(body.quality_score) : undefined,
      isDisposable: body.is_disposable_email?.value,
      isFreeEmail: body.is_free_email?.value,
      isRoleEmail: body.is_role_email?.value,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
