import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2, ShieldQuestion, GitBranch } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { getAttributionChainForInvoice, type EvidenceLink, type Touchpoint, type DataQualityFlag } from "@/lib/analytics/revenue-attribution";

const TYPE_VARIANT: Record<string, "accent" | "secondary" | "outline"> = {
  DIRECT: "accent",
  ASSISTED: "secondary",
  UNKNOWN: "outline",
};

// Real dashboard route each real recordType actually resolves to — never a
// fabricated link. Anything not listed here renders as plain text.
const RECORD_LINK: Record<string, (id: string) => string> = {
  Company: (id) => `/dashboard/companies/${id}`,
  Deal: (id) => `/dashboard/crm/deals/${id}`,
  Contact: (id) => `/dashboard/outreach/contacts/${id}`,
  Campaign: (id) => `/dashboard/outreach/campaigns/${id}`,
  Proposal: (id) => `/dashboard/proposal/proposals/${id}`,
  Reply: () => `/dashboard/outreach/inbox`,
  EmailDraft: () => `/dashboard/outreach/inbox`,
};

export default async function RevenueAttributionDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/revenue-command-center/attribution/${invoiceId}`);

  const attribution = await getAttributionChainForInvoice(membership.organizationId, invoiceId);
  if (!attribution) notFound();

  const evidence = attribution.evidence as unknown as EvidenceLink[];
  const touchpoints = attribution.touchpoints as unknown as Touchpoint[];
  const dataQualityFlags = attribution.dataQualityFlags as unknown as DataQualityFlag[];
  const currency = membership.organization.currency;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link
          href="/dashboard/revenue-command-center"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Revenue Command Center
        </Link>

        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <GitBranch className="size-6 text-primary" /> Revenue Attribution Chain
          </h1>
          <p className="text-sm text-muted-foreground">
            Real paid revenue of {formatCurrency(attribution.revenueAmount, currency)} traced backwards through every
            real, stored record that actually connects to it. Stages with no real record are simply absent — never
            invented.
          </p>
        </div>

        <Card glass>
          <CardContent className="flex flex-wrap items-center gap-3 p-5">
            <Badge variant={TYPE_VARIANT[attribution.attributionType]} className="text-sm">
              {attribution.attributionType} ATTRIBUTION
            </Badge>
            <Badge variant="outline">{attribution.confidence} confidence</Badge>
            <span className="text-xs text-muted-foreground">Rule: {attribution.attributionRule}</span>
            <span className="text-xs text-muted-foreground">Computed {attribution.computedAt.toLocaleString()}</span>
          </CardContent>
        </Card>

        {touchpoints.length > 0 && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {attribution.attributionType === "ASSISTED" ? "Touchpoints (no single winner claimed)" : "Touchpoint"}
            </h2>
            <div className="flex flex-col gap-2">
              {touchpoints.map((tp, i) => (
                <Card key={i} glass>
                  <CardContent className="flex items-center gap-2 p-3 text-sm">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-foreground">{tp.type}</span>
                    <span className="text-foreground">{tp.label}</span>
                    <span className="text-xs text-muted-foreground">{tp.evidenceSummary}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence Chain — Revenue → Source
          </h2>
          <Card glass>
            <CardContent className="flex flex-col gap-0 p-0">
              {evidence.map((link: EvidenceLink, i: number) => {
                const linkFn = RECORD_LINK[link.recordType];
                const href = linkFn ? linkFn(link.recordId) : null;
                return (
                  <div key={i} className={`flex items-center gap-3 border-border p-3 ${i !== evidence.length - 1 ? "border-b" : ""}`}>
                    <span className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{link.stage}</span>
                    <div className="flex flex-1 flex-col">
                      {href ? (
                        <Link href={href} className="text-sm text-primary hover:underline">
                          {link.recordType} — {link.recordId}
                        </Link>
                      ) : (
                        <span className="text-sm text-foreground">
                          {link.recordType} — {link.recordId}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{link.description}</span>
                    </div>
                    <Badge variant={link.proofType === "DIRECT_FK" ? "accent" : "outline"} className="shrink-0 text-[10px]">
                      {link.proofType === "DIRECT_FK" ? "PROVEN LINK" : link.proofType === "CONTRIBUTING_SIGNAL" ? "SIGNAL ONLY" : "ASSOCIATED"}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {dataQualityFlags.length > 0 && (
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldQuestion className="size-3.5" /> Data Quality Notes
            </h2>
            <Card glass>
              <CardContent className="flex flex-col gap-1 p-4">
                {dataQualityFlags.map((f, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{f.code}</span> — {f.description}
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </Container>
    </main>
  );
}
