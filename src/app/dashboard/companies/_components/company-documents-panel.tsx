import Link from "next/link";
import { Receipt } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/app/dashboard/_lib/format";

export type CompanyDocumentKind = "CONTRACT" | "INVOICE" | "QUOTATION" | "SUBSCRIPTION";

export interface CompanyDocumentRow {
  id: string;
  kind: CompanyDocumentKind;
  number: string | null;
  title: string;
  status: string;
  amount: number | null;
  date: string | null;
  href: string | null;
}

const KIND_LABEL: Record<CompanyDocumentKind, string> = {
  CONTRACT: "Contract",
  INVOICE: "Invoice",
  QUOTATION: "Quotation",
  SUBSCRIPTION: "Subscription",
};

const GOOD_STATUSES = new Set(["SIGNED", "PAID", "ACCEPTED", "ACTIVE"]);
const IN_PROGRESS_STATUSES = new Set(["DRAFT", "TRIALING", "PAUSED"]);
const BAD_STATUSES = new Set(["OVERDUE", "REJECTED", "EXPIRED", "CANCELLED", "VOID", "ARCHIVED"]);

/**
 * Status color heuristic shared by every document kind's own enum
 * (ContractStatus/InvoiceStatus/QuotationStatus/SubscriptionStatus) — same
 * "good/in-progress/sent/bad" color banding as STATUS_BADGE_CLASSNAME in
 * opportunities/_lib/opportunity-display.ts, generalized across kinds
 * rather than one Record per enum, since the same four buckets recur in
 * every one of them.
 */
function statusClassName(status: string): string {
  if (GOOD_STATUSES.has(status)) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status === "SENT") return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (BAD_STATUSES.has(status)) return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";
  if (IN_PROGRESS_STATUSES.has(status)) return "border-border bg-muted text-muted-foreground";
  return "border-border bg-muted text-muted-foreground";
}

/**
 * Unified Contracts + Invoices + Quotations + Subscriptions panel — these
 * four real Company relations exist in the schema and get populated
 * elsewhere in the app, but were never rendered on the company's own
 * detail page. Shown together rather than as four near-empty cards, since
 * they're all "money/paper" tied to this company and most companies will
 * only have a couple of each.
 */
export function CompanyDocumentsPanel({ documents }: { documents: CompanyDocumentRow[] }) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="size-4" /> Documents &amp; Billing ({documents.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 pt-0">
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No contracts, invoices, quotations, or subscriptions for this company yet.</p>
        ) : (
          documents.map((doc) => {
            const content = (
              <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="shrink-0">
                  {KIND_LABEL[doc.kind]}
                </Badge>
                <span className={`truncate font-medium ${doc.href ? "text-foreground group-hover:text-primary" : "text-foreground"}`}>
                  {doc.number ? `${doc.number} — ${doc.title}` : doc.title}
                </span>
              </div>
            );

            return (
              <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                {doc.href ? (
                  <Link href={doc.href} className="group flex flex-1 items-center gap-2">
                    {content}
                  </Link>
                ) : (
                  <div className="flex flex-1 items-center gap-2">{content}</div>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {doc.amount != null && <span className="text-xs text-muted-foreground">{formatCurrency(doc.amount)}</span>}
                  {doc.date && <span className="text-xs text-muted-foreground">{new Date(doc.date).toLocaleDateString()}</span>}
                  <Badge variant="outline" className={statusClassName(doc.status)}>
                    {doc.status}
                  </Badge>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
