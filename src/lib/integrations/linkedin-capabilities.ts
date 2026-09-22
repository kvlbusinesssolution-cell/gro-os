import { prisma } from "@/lib/prisma";
import { getConnection } from "./connection-store";

/**
 * Phase 9 (LinkedIn Sales Intelligence) §2/§3/§45 — the capability matrix.
 * Every LinkedIn-touching feature in this codebase MUST read its own
 * status from here rather than assuming — this is the single place that
 * knows what the ONE real product this app is approved for ("Sign In with
 * LinkedIn using OpenID Connect", openid/profile/email) actually permits.
 *
 * The vast majority of capabilities below are hard-`NOT_SUPPORTED`
 * regardless of connection state — not a per-org permission gap, but a
 * genuine product-access gap: LinkedIn's company/page data, messaging,
 * connections, engagement signals, and marketing/lead-sync APIs all
 * require a separate Partner Program application this app was never
 * granted (confirmed with the org's owner before Phase 9 implementation —
 * see linkedin.ts's doc comment). Building any of those against real
 * endpoints would either be rejected by LinkedIn outright or require
 * scraping/automation this project is expressly forbidden from building.
 */

export type LinkedInCapabilityStatus = "AVAILABLE" | "NOT_CONNECTED" | "PERMISSION_REQUIRED" | "NOT_APPROVED" | "NOT_SUPPORTED";

export interface LinkedInCapabilityResult {
  key: string;
  label: string;
  status: LinkedInCapabilityStatus;
  detail: string;
}

export interface LinkedInIntegrationSummary {
  status: "NOT_CONNECTED" | "CONNECTED" | "ERROR" | "EXPIRED";
  connectedAccountName: string | null;
  connectedAccountEmail: string | null;
  scopes: string[];
  apiVersion: string;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  capabilities: LinkedInCapabilityResult[];
}

// LinkedIn's OpenID Connect endpoints are not date-versioned the way the
// REST/Marketing APIs are (those use a YYYYMM header this app never calls)
// — recorded here per §33 purely as "which product/spec this integration
// was built against," so a future reviewer knows what to re-verify before
// trusting this code, not because a request literally sends this string.
const INTEGRATION_VERSION = "LinkedIn OpenID Connect (Sign In with LinkedIn) — verified against developer.linkedin.com docs as of this phase's implementation";

/** Real, honest matrix — computed from actual connection state, never assumed. */
export async function getLinkedInCapabilities(organizationId: string): Promise<LinkedInIntegrationSummary> {
  const connection = await getConnection(organizationId, "LINKEDIN");
  const metadata = (connection?.metadata as { name?: string; email?: string; lastVerifiedAt?: string } | null | undefined) ?? null;

  const connected = connection?.status === "CONNECTED" && !!connection.accessToken;

  const capabilities: LinkedInCapabilityResult[] = [
    {
      key: "profile_read",
      label: "Profile (connected member only)",
      status: connected ? "AVAILABLE" : "NOT_CONNECTED",
      detail: connected
        ? "Real name/email/picture for the one real person who connected this integration — never an arbitrary prospect's profile."
        : "Connect a LinkedIn account at /dashboard/settings/integrations to make this available.",
    },
    {
      key: "organization_access",
      label: "Company/Organization page data",
      status: "NOT_SUPPORTED",
      detail: "Requires LinkedIn's Marketing Developer Platform partner access, which this app does not have.",
    },
    {
      key: "member_activity",
      label: "Arbitrary member profile/activity lookup",
      status: "NOT_SUPPORTED",
      detail: "Requires LinkedIn partner API access this app does not have. Never implemented via scraping.",
    },
    {
      key: "messaging",
      label: "LinkedIn messaging (read or send)",
      status: "NOT_SUPPORTED",
      detail: "LinkedIn's Messaging API is partner-restricted. AI-drafted LinkedIn messages remain a human-copy-paste workflow (existing DraftChannel.LINKEDIN), never an automated send.",
    },
    {
      key: "connection_data",
      label: "Connection status / connections list",
      status: "NOT_SUPPORTED",
      detail: "Requires partner API access this app does not have. Never inferred from profile visibility.",
    },
    {
      key: "page_activity",
      label: "Company page activity/posts",
      status: "NOT_SUPPORTED",
      detail: "Requires Marketing Developer Platform partner access this app does not have.",
    },
    {
      key: "analytics",
      label: "LinkedIn analytics",
      status: "NOT_SUPPORTED",
      detail: "Requires Marketing Developer Platform partner access this app does not have.",
    },
    {
      key: "campaign_access",
      label: "LinkedIn Ads / campaign API",
      status: "NOT_SUPPORTED",
      detail: "Requires LinkedIn Marketing API partner access this app does not have.",
    },
    {
      key: "lead_sync",
      label: "LinkedIn Lead Sync API",
      status: "NOT_SUPPORTED",
      detail: "Requires LinkedIn partner API access this app does not have.",
    },
    {
      key: "compliance",
      label: "Opt-out / consent tracking",
      status: "AVAILABLE",
      detail: "Internal GrowthOS bookkeeping (reuses the existing Phase 4 suppression architecture) — not dependent on any LinkedIn API access.",
    },
  ];

  return {
    status: connection?.status ?? "NOT_CONNECTED",
    connectedAccountName: metadata?.name ?? null,
    connectedAccountEmail: metadata?.email ?? null,
    scopes: connection?.scopes ?? [],
    apiVersion: INTEGRATION_VERSION,
    connectedAt: connection ? (await getConnectedAt(organizationId)) : null,
    lastVerifiedAt: connection?.lastHealthCheckAt?.toISOString() ?? metadata?.lastVerifiedAt ?? null,
    lastError: connection?.lastError ?? null,
    capabilities,
  };
}

async function getConnectedAt(organizationId: string): Promise<string | null> {
  const row = await prisma.integrationConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: "LINKEDIN" } }, select: { createdAt: true } });
  return row?.createdAt.toISOString() ?? null;
}

/** Convenience guard for callers that just need a yes/no before attempting a capability-gated action (§5: never attempt a request without checking first). */
export async function hasLinkedInCapability(organizationId: string, key: string): Promise<boolean> {
  const summary = await getLinkedInCapabilities(organizationId);
  return summary.capabilities.find((c) => c.key === key)?.status === "AVAILABLE";
}
