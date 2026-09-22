import type { HealthCheckResult, IntegrationAdapter, OAuthTokenResult } from "../types";

/**
 * Phase 9 (LinkedIn Sales Intelligence) — LinkedIn's "Sign In with LinkedIn
 * using OpenID Connect" product (openid/profile/email). This is the ONLY
 * product a self-serve LinkedIn Developer app is granted by default; the
 * broader capabilities the Phase 9 spec describes (company/page data,
 * messaging, connections, engagement signals, employment-change tracking,
 * marketing/lead-sync APIs) require LinkedIn's separate Partner Program
 * approval this app does not have (confirmed with the org before writing
 * this file — see linkedin-capabilities.ts, which is what actually gates
 * every feature on real granted scopes rather than assuming any of this).
 *
 * Written from LinkedIn's stable, long-documented OIDC conventions
 * (developer.linkedin.com/docs) without live doc access in this session —
 * verify against current docs before relying on this in production (same
 * disclaimer docusign.ts already carries for the same reason).
 *
 * Reuses the SAME registered app (LINKEDIN_CLIENT_ID/SECRET) already
 * configured in this environment for NextAuth's "Sign in with LinkedIn"
 * login provider — but this is a SEPARATE, org-level connection (via the
 * generic /api/integrations/LINKEDIN/{connect,callback} flow, distinct
 * callback URL, its own IntegrationConnection row) representing whichever
 * real person explicitly authorizes it as the org's designated LinkedIn
 * identity for Phase 9 purposes — never conflated with "the org's LinkedIn
 * company page" (this app has no access to that) or with a specific
 * prospect's LinkedIn identity.
 */

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

// The only scopes a self-serve "Sign In with LinkedIn using OpenID Connect"
// app is granted. Do NOT add w_member_social / r_organization_social /
// rw_ads / r_1st_connections_size etc. here — requesting a scope this app
// was never approved for would make LinkedIn reject the whole consent
// request, not just silently omit it.
const SCOPES = ["openid", "profile", "email"];

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface LinkedInUserInfo {
  sub: string; // LinkedIn's stable member identifier for this app
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: string;
}

function isConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_CLIENT_ID) && Boolean(process.env.LINKEDIN_CLIENT_SECRET);
}

async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LinkedIn userinfo request failed (HTTP ${response.status}): ${body.slice(0, 200)}`);
  }
  return (await response.json()) as LinkedInUserInfo;
}

export const linkedinAdapter: IntegrationAdapter = {
  key: "LINKEDIN",
  name: "LinkedIn",
  category: "COMMUNICATION",
  authType: "OAUTH2",
  requiredEnvVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  isConfigured,

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, redirectUri: string): Promise<OAuthTokenResult> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? "",
        client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as LinkedInTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(`LinkedIn token endpoint rejected the request (HTTP ${response.status}): ${body.error_description ?? body.error ?? JSON.stringify(body)}`);
    }

    // Real granted scopes only — never assume every requested scope was
    // actually granted (§5: verify required scope, don't assume).
    const grantedScopes = body.scope ? body.scope.split(/[\s,]+/).filter(Boolean) : SCOPES;

    // Fetch the real profile once at connect time — this IS the entire
    // "LinkedIn Profile" capability this product grants (§8): member
    // identifier, name, email, picture, for the one real person who just
    // authorized this. Never guessed, never scraped.
    const profile = await fetchUserInfo(body.access_token);

    return {
      accessToken: body.access_token,
      // LinkedIn's OpenID Connect product does not issue a refresh_token —
      // the access token is long-lived (~60 days) and re-consent is
      // required after expiry. Documented honestly rather than
      // implementing a refreshAccessToken that would always fail.
      refreshToken: undefined,
      expiresAt: new Date(Date.now() + body.expires_in * 1000),
      scopes: grantedScopes,
      metadata: {
        memberSub: profile.sub,
        name: profile.name ?? null,
        email: profile.email ?? null,
        emailVerified: profile.email_verified ?? null,
        pictureUrl: profile.picture ?? null,
        lastVerifiedAt: new Date().toISOString(),
      },
    };
  },

  // refreshAccessToken intentionally omitted — see the comment above
  // handleCallback's return. With no refreshToken on file,
  // connection-store's getFreshAccessToken just keeps returning the
  // existing access token past its expiry (never loops trying to refresh);
  // it's this adapter's own healthCheck below — run periodically via
  // runHealthCheck — that will then start failing and flip the connection
  // to ERROR once the ~60-day token genuinely stops working, at which
  // point the UI must show "reconnect required," never a silent failure.

  async healthCheck(accessToken: string): Promise<HealthCheckResult> {
    try {
      const profile = await fetchUserInfo(accessToken);
      return { ok: true, detail: profile.name ?? profile.sub };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "LinkedIn userinfo check failed." };
    }
  },

  async revoke(): Promise<void> {
    // LinkedIn has no documented public endpoint for a third-party app to
    // remotely revoke a member's issued access token (same class of
    // limitation as docusign.ts/bitbucket.ts in this same registry). The
    // local IntegrationConnection row is removed by connection-store's
    // disconnectConnection regardless; the member can additionally revoke
    // this app's access themselves from linkedin.com/psettings/permitted-services.
    console.warn(
      "[linkedin] LinkedIn has no documented public API to remotely revoke an OAuth access token; the local connection is being removed, but the member should also review linkedin.com/psettings/permitted-services to fully revoke this app's access.",
    );
  },
};
