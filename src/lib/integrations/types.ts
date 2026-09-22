/**
 * Integration Layer — provider-agnostic OAuth/API-key/webhook framework.
 *
 * Every external account-linked service implements IntegrationAdapter below
 * and registers itself in src/lib/integrations/registry.ts. Business code
 * (src/lib/outreach/email-provider.ts, src/lib/documents/signature.ts, the
 * OAuth callback/webhook routes, workflow node executors) only ever calls
 * src/lib/integrations/connection-store.ts + the registry — never a
 * concrete provider file directly — so adding a new provider never touches
 * a business module.
 *
 * Two auth shapes are supported:
 * - OAUTH2: a real 3-legged consent flow (getAuthUrl/handleCallback/
 *   refreshAccessToken). Connected via the redirect-based
 *   /api/integrations/[provider]/{connect,callback} routes.
 * - API_KEY: the provider issues a long-lived credential (API key, secret,
 *   bot token, access key pair, ...) with no browser consent step.
 *   Connected via a credential-entry form
 *   (POST /api/integrations/[provider]/connect-api-key) that calls
 *   connectWithCredentials() and, on a real successful verification call,
 *   stores the credential the same way an OAuth access token is stored
 *   (AES-256-GCM, IntegrationConnection.encryptedAccessToken) so every
 *   downstream consumer (connection-store.getFreshAccessToken, health
 *   checks, revoke) works identically regardless of auth shape.
 *
 * Never-fake contract: an adapter must never report a connection as healthy
 * or return a token/credential result unless a real HTTP call to the
 * provider actually succeeded. If required env vars are missing,
 * isConfigured() returns false and the UI shows "Not Connected — requires
 * <ENV_VAR>", never a simulated success.
 */

export type IntegrationProviderKey =
  // Email
  | "GOOGLE_GMAIL"
  | "MICROSOFT_OUTLOOK"
  | "SENDGRID"
  | "MAILGUN"
  | "AMAZON_SES"
  // Calendar
  | "GOOGLE_CALENDAR"
  | "MICROSOFT_CALENDAR"
  | "CAL_COM"
  | "CALENDLY"
  // Signature
  | "DOCUSIGN"
  | "ADOBE_SIGN"
  | "DROPBOX_SIGN"
  // CRM sync
  | "HUBSPOT"
  | "SALESFORCE"
  | "ZOHO_CRM"
  | "PIPEDRIVE"
  | "FRESHSALES"
  // Communication
  | "SLACK"
  | "MICROSOFT_TEAMS"
  | "DISCORD"
  | "TELEGRAM"
  | "TWILIO"
  | "LINKEDIN"
  // Storage
  | "GOOGLE_DRIVE"
  | "DROPBOX"
  | "ONEDRIVE"
  | "AWS_S3"
  | "CLOUDFLARE_R2"
  // Payments
  | "STRIPE"
  | "RAZORPAY"
  | "PAYPAL"
  | "PADDLE"
  | "LEMONSQUEEZY"
  // Accounting
  | "QUICKBOOKS"
  | "XERO"
  | "ZOHO_BOOKS"
  // Meetings
  | "ZOOM"
  | "GOOGLE_MEET"
  // Development
  | "GITHUB"
  | "GITLAB"
  | "BITBUCKET"
  | "VERCEL"
  | "NETLIFY"
  | "CLOUDFLARE"
  // AI providers
  | "OPENAI"
  | "GOOGLE_GEMINI"
  | "DEEPSEEK"
  | "GROQ"
  | "OPENROUTER"
  | "OLLAMA"
  // Embedding providers (Phase 17 RAG Engine)
  | "VOYAGE_AI"
  | "COHERE"
  | "JINA_EMBEDDINGS"
  | "BGE";

export type IntegrationCategory =
  | "EMAIL"
  | "CALENDAR"
  | "SIGNATURE"
  | "CRM_SYNC"
  | "COMMUNICATION"
  | "STORAGE"
  | "PAYMENTS"
  | "ACCOUNTING"
  | "MEETINGS"
  | "DEVELOPMENT"
  | "AI_PROVIDER";

export type IntegrationAuthType = "OAUTH2" | "API_KEY";

export interface OAuthTokenResult {
  accessToken: string;
  /** Absent for providers that don't issue refresh tokens on every grant (e.g. re-consent required instead), and always absent for API_KEY adapters. */
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  /** Non-secret provider details worth remembering, e.g. connected mailbox address, DocuSign account/base URI, Slack workspace name. */
  metadata?: Record<string, unknown>;
}

export interface HealthCheckResult {
  ok: boolean;
  detail?: string;
}

/** Describes one input field a credential-entry form must collect for an API_KEY adapter. Never rendered for OAUTH2 adapters. */
export interface ApiKeyCredentialField {
  /** Key this value is passed under in the `credentials` record handed to connectWithCredentials. */
  key: string;
  label: string;
  /** Masked <input type="password"> when true (the default) — every credential field is a secret unless explicitly marked otherwise. */
  secret?: boolean;
  placeholder?: string;
}

export interface IntegrationAdapter {
  key: IntegrationProviderKey;
  name: string;
  category: IntegrationCategory;
  authType: IntegrationAuthType;
  /** Human-readable list of required env vars, shown in the Integration Management page when not configured. */
  requiredEnvVars: string[];
  /** True only when every required env var is actually set. */
  isConfigured(): boolean;

  // ---- OAUTH2 adapters only ----
  /** Builds the provider's consent-screen URL. `state` must be embedded and verified on callback (CSRF protection). */
  getAuthUrl?(state: string, redirectUri: string): string;
  /** Exchanges a real authorization code for tokens. Throws on any failure — never returns a fabricated result. */
  handleCallback?(code: string, redirectUri: string): Promise<OAuthTokenResult>;
  /** Exchanges a refresh token for a new access token. Throws if the provider rejects it (caller marks the connection EXPIRED). */
  refreshAccessToken?(refreshToken: string): Promise<OAuthTokenResult>;

  // ---- API_KEY adapters only ----
  /** Input fields a credential-entry form must render for this provider. */
  credentialFields?: ApiKeyCredentialField[];
  /** Verifies the submitted credential(s) with a real API call and returns the value to store as the connection's access token. Throws on invalid/rejected credentials — never stores an unverified value. */
  connectWithCredentials?(credentials: Record<string, string>): Promise<OAuthTokenResult>;

  /** Real API probe using a live access token / stored credential. */
  healthCheck(accessToken: string): Promise<HealthCheckResult>;
  /** Best-effort provider-side revoke; must never throw — disconnect always succeeds locally regardless of provider response. */
  revoke(accessToken: string): Promise<void>;
}
