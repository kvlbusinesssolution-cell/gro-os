import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkedInIcon } from "@/components/icons/oauth-icons";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getLinkedInCapabilities } from "@/lib/integrations/linkedin-capabilities";

const STATUS_VARIANT: Record<string, "accent" | "secondary" | "outline"> = {
  AVAILABLE: "accent",
  NOT_CONNECTED: "outline",
  PERMISSION_REQUIRED: "secondary",
  NOT_APPROVED: "secondary",
  NOT_SUPPORTED: "outline",
};

/**
 * Phase 9 (LinkedIn Sales Intelligence) §45 — the honest capability
 * breakdown so nobody assumes an unsupported feature exists. The real
 * connect/disconnect/health-check flow itself already works generically at
 * /dashboard/settings/integrations (linkedinAdapter is registered there —
 * this page only adds the LinkedIn-specific capability detail that generic
 * page doesn't show).
 */
export default async function LinkedInSettingsPage() {
  const { membership } = await requireActiveMembership("/dashboard/settings/linkedin");
  const summary = await getLinkedInCapabilities(membership.organizationId);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <LinkedInIcon className="size-6" /> LinkedIn Integration
          </h1>
          <p className="text-sm text-muted-foreground">
            Uses only LinkedIn&apos;s official Sign In with LinkedIn (OpenID Connect) product — no scraping, no
            browser automation, no unofficial workflows. Most advanced capabilities require LinkedIn Partner Program
            approval this app does not have, and are honestly marked below rather than faked.
          </p>
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle className="text-base">Connection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={summary.status === "CONNECTED" ? "accent" : "outline"}>{summary.status}</Badge>
              {summary.connectedAccountName && <span className="text-foreground">{summary.connectedAccountName}</span>}
              {summary.connectedAccountEmail && <span className="text-muted-foreground">({summary.connectedAccountEmail})</span>}
            </div>
            {summary.status !== "CONNECTED" && (
              <Link href="/api/integrations/LINKEDIN/connect" className="w-fit">
                <Badge variant="accent" className="cursor-pointer px-3 py-1.5">Connect LinkedIn</Badge>
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
              <p>Scopes: {summary.scopes.length > 0 ? summary.scopes.join(", ") : "—"}</p>
              <p>Connected: {summary.connectedAt ? new Date(summary.connectedAt).toLocaleString() : "—"}</p>
              <p>Last verified: {summary.lastVerifiedAt ? new Date(summary.lastVerifiedAt).toLocaleString() : "—"}</p>
              <p>Last error: {summary.lastError ?? "—"}</p>
            </div>
            <p className="text-xs text-muted-foreground">{summary.apiVersion}</p>
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Available Capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {summary.capabilities.map((c) => (
              <div key={c.key} className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status.replaceAll("_", " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
