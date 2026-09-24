import { ShieldCheck, Globe, Server, Activity } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getEmailHealthOverviewAction, getSuppressionListAction, getProviderEventHistoryAction } from "../_lib/email-health-actions";
import { SendingIdentityCard } from "./_components/sending-identity-card";

const DOMAIN_STATUS_VARIANT: Record<string, "outline" | "accent" | "secondary" | "default"> = {
  GOOD: "accent",
  WARNING: "secondary",
  CRITICAL: "default",
  NOT_VERIFIED: "outline",
};

export default async function EmailHealthPage() {
  await requireActiveMembership("/dashboard/outreach/email-health");

  const [overview, suppression, events] = await Promise.all([getEmailHealthOverviewAction(), getSuppressionListAction(), getProviderEventHistoryAction()]);

  const identities = overview.ok ? overview.data!.identities : [];
  const domains = overview.ok ? overview.data!.domains : [];

  const healthy = identities.filter((i) => i.health.status === "GOOD" || i.health.status === "NOT_VERIFIED").length;
  const warning = identities.filter((i) => i.health.status === "WARNING").length;
  const critical = identities.filter((i) => i.health.status === "CRITICAL").length;
  const paused = identities.filter((i) => i.status === "PAUSED").length;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="size-6" /> Email Health Center
          </h1>
          <p className="text-sm text-muted-foreground">Real sender reputation, bounce/complaint tracking, rate limits, and the automatic safety circuit breaker.</p>
        </div>

        {!overview.ok && <p className="text-sm text-destructive">{overview.error}</p>}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card glass>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Healthy</p>
              <p className="text-2xl font-semibold text-foreground">{healthy}</p>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Warning</p>
              <p className="text-2xl font-semibold text-foreground">{warning}</p>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Critical</p>
              <p className="text-2xl font-semibold text-foreground">{critical}</p>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Paused</p>
              <p className="text-2xl font-semibold text-foreground">{paused}</p>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Server className="size-4" /> Sending Identities ({identities.length})
          </h2>
          {identities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sending identity has sent a real email yet — one is registered automatically on the first real send.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {identities.map((identity) => (
                <SendingIdentityCard key={identity.id} identity={identity} />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Globe className="size-4" /> Domain Health
          </h2>
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domain to verify yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {domains.map((d) => (
                <Card key={d.domain} glass>
                  <CardContent className="flex flex-wrap items-center gap-4 pt-4 text-xs">
                    <span className="font-medium text-foreground">{d.domain}</span>
                    <span>
                      SPF: <Badge variant={DOMAIN_STATUS_VARIANT[d.spf.status]}>{d.spf.status}</Badge>
                    </span>
                    <span>
                      DKIM: <Badge variant={DOMAIN_STATUS_VARIANT[d.dkim.status]}>{d.dkim.status}</Badge>
                    </span>
                    <span>
                      DMARC: <Badge variant={DOMAIN_STATUS_VARIANT[d.dmarc.status]}>{d.dmarc.status}</Badge>
                    </span>
                    <span title={d.blacklist.detail}>
                      Blacklist: <Badge variant={DOMAIN_STATUS_VARIANT[d.blacklist.status]}>{d.blacklist.status}</Badge>
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Activity className="size-4" /> Recent Provider Events
          </h2>
          {!events.ok || events.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No provider events recorded yet.</p>
          ) : (
            <Card glass>
              <CardContent className="flex flex-col gap-2 pt-4 text-xs">
                {events.data.slice(0, 20).map((e) => (
                  <div key={e.id} className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
                    <span>
                      {e.eventType} — {e.recipient}
                    </span>
                    <span className="text-muted-foreground">{new Date(e.receivedAt).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Suppression List ({!suppression.ok ? 0 : suppression.data.length})</h2>
          {!suppression.ok || suppression.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppressed recipients yet.</p>
          ) : (
            <Card glass>
              <CardContent className="flex flex-col gap-2 pt-4 text-xs">
                {suppression.data.slice(0, 20).map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
                    <span>{s.email}</span>
                    <span className="text-muted-foreground">
                      {s.reason} — {s.source}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </Container>
    </main>
  );
}
