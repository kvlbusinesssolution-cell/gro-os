import { LayoutDashboard } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ClientSummary, Confidence } from "@/lib/business-development/client-360";

const CONFIDENCE_VARIANT: Record<Confidence, "outline" | "accent" | "secondary"> = {
  CONFIRMED: "accent",
  INFERRED: "secondary",
  UNKNOWN: "outline",
};

function Field({ label, value, status, source }: { label: string; value: string | null; status: Confidence; source?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <Badge variant={CONFIDENCE_VARIANT[status]} className="text-[10px]">
          {status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{value ?? "Not found in stored records."}</p>
      {source && status !== "UNKNOWN" && <p className="text-[10px] text-muted-foreground/70">{source}</p>}
    </div>
  );
}

/**
 * Phase 5 (Client 360 / Account 360) — the relationship summary panel.
 * Every field is either a real value with its source cited, or an honest
 * "Not found in stored records" — never presents an inference as fact
 * (each field's CONFIRMED/INFERRED/UNKNOWN badge is the actual value from
 * buildClientSummary, not a UI-only label).
 */
export function Client360SummaryPanel({ summary }: { summary: ClientSummary | null }) {
  if (!summary) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="size-4" /> Client 360 Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">No summary available yet — this company has no stored activity.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutDashboard className="size-4" /> Client 360 Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2">
        <Field label="Current Situation" value={summary.currentSituation.value} status={summary.currentSituation.status} source={summary.currentSituation.source} />
        <Field label="Client Wants" value={summary.clientWants.value?.join("; ") ?? null} status={summary.clientWants.status} source={summary.clientWants.source} />
        <Field label="What We Promised" value={summary.whatWePromised.value} status={summary.whatWePromised.status} source={summary.whatWePromised.source} />
        <Field label="Open Issues" value={summary.openIssues.value?.join("; ") ?? null} status={summary.openIssues.status} source={summary.openIssues.source} />
        <Field label="Objections" value={summary.objections.value?.join("; ") ?? null} status={summary.objections.status} source={summary.objections.source} />
        <Field label="Historical Cohort Observation" value={summary.historicalCohortObservation.value} status={summary.historicalCohortObservation.status} source={summary.historicalCohortObservation.source} />
        <Field
          label="Last Contact"
          value={summary.lastContact ? `${new Date(summary.lastContact.date).toLocaleString()} — ${summary.lastContact.channel} (${summary.lastContact.direction})` : null}
          status={summary.lastContact ? "CONFIRMED" : "UNKNOWN"}
          source={summary.lastContact ? `${summary.lastContact.recordType}:${summary.lastContact.recordId}` : null}
        />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">Next Action</span>
            <Badge variant="outline" className="text-[10px]">
              {summary.nextAction.kind.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{summary.nextAction.action}</p>
          {summary.aiRecommendedAction && (
            <p className="text-[10px] text-muted-foreground/70">
              <Badge variant="secondary" className="mr-1 text-[9px]">
                AI RECOMMENDATION
              </Badge>
              {summary.aiRecommendedAction}
            </p>
          )}
        </div>
        <Field label="Deal Value" value={summary.dealValue.value != null ? String(summary.dealValue.value) : null} status={summary.dealValue.status} source={summary.dealValue.source} />
        <Field
          label="Revenue"
          value={summary.revenue.source === "UNKNOWN" ? null : `Invoiced ${summary.revenue.invoiced} · Paid ${summary.revenue.paid}`}
          status={summary.revenue.source}
        />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">Risk</span>
            <Badge variant={CONFIDENCE_VARIANT[summary.risk.status]} className="text-[10px]">
              {summary.risk.status}
            </Badge>
            {summary.risk.level !== "UNKNOWN" && <Badge variant="outline">{summary.risk.level}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{summary.risk.reasons.length > 0 ? summary.risk.reasons.join("; ") : "No risk signal found in stored records."}</p>
        </div>
      </CardContent>
    </Card>
  );
}
