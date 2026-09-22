import Link from "next/link";
import { UserSearch, MessageSquare, Sparkles, ShieldAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkedInIcon } from "@/components/icons/oauth-icons";
import type { CompanyLinkedInIntelligence } from "@/lib/business-development/linkedin-intelligence";

const NOT_AVAILABLE_ITEMS: Array<{ key: keyof CompanyLinkedInIntelligence; label: string }> = [
  { key: "employmentChangeSignals", label: "Employment Change" },
  { key: "companySignals", label: "Company Signal" },
  { key: "engagementSignals", label: "Engagement Signal" },
];

/**
 * Phase 9 (LinkedIn Sales Intelligence) §44 — the LinkedIn Intelligence
 * panel. Every "NOT AVAILABLE" badge below is real and intentional (see
 * linkedin-capabilities.ts) — this app's LinkedIn access is limited to
 * "Sign In with LinkedIn" only, so profile/company/employment/engagement
 * signal data has no real source and is never faked to fill the panel.
 */
export function LinkedInIntelligencePanel({ data }: { data: CompanyLinkedInIntelligence }) {
  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkedInIcon className="size-4" /> LinkedIn Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {/* Profile / Company */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <UserSearch className="size-3.5" /> Profile &amp; Company
          </p>
          <div className="flex flex-col gap-2">
            {data.company.pageUrl && (
              <Link href={data.company.pageUrl} target="_blank" className="text-sm text-primary hover:underline">
                Company LinkedIn page
              </Link>
            )}
            {data.contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No contacts on file for this company yet.</p>
            ) : (
              data.contacts.map((c) => (
                <div key={c.contactId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
                  <span className="font-medium text-foreground">{c.name}</span>
                  {c.jobTitle && <span className="text-xs text-muted-foreground">{c.jobTitle}</span>}
                  {c.seniority && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      {c.seniority.value} <span className="text-muted-foreground">({c.seniority.classification})</span>
                    </Badge>
                  )}
                  {c.profileUrl ? (
                    <Link href={c.profileUrl} target="_blank" className="text-xs text-primary hover:underline">
                      Profile ↗
                    </Link>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">NOT AVAILABLE</Badge>
                  )}
                </div>
              ))
            )}
            <Badge variant="outline" className="w-fit text-[10px] text-muted-foreground">
              Connection Status: NOT AVAILABLE
            </Badge>
          </div>
        </div>

        {/* Signals — honestly unavailable */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="size-3.5" /> Signals
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NOT_AVAILABLE_ITEMS.map((item) => (
              <Badge key={item.key} variant="outline" className="text-[10px] text-muted-foreground">
                {item.label}: NOT AVAILABLE — LINKEDIN ACCESS REQUIRED
              </Badge>
            ))}
          </div>
        </div>

        {/* AI Recommendation */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3.5" /> AI Recommendation
          </p>
          {!data.recommendation.hasRecommendation ? (
            <p className="text-xs text-muted-foreground">{data.recommendation.why}</p>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
              <p>
                <span className="font-semibold text-foreground">WHO: </span>
                {data.recommendation.who ? `${data.recommendation.who.name} (${data.recommendation.who.role.replaceAll("_", " ").toLowerCase()})` : "No matched CRM contact"}
              </p>
              <p>
                <span className="font-semibold text-foreground">WHY: </span>
                {data.recommendation.why}
              </p>
              <p>
                <span className="font-semibold text-foreground">WHEN: </span>
                {data.recommendation.when.recommendation === "NOW" ? "Now" : `Wait — ${data.recommendation.when.reason}`}
              </p>
              {data.recommendation.messageAngle && (
                <p>
                  <span className="font-semibold text-foreground">MESSAGE ANGLE: </span>
                  {data.recommendation.messageAngle}
                </p>
              )}
              <div className="flex items-center gap-1.5">
                <Badge variant="outline">{data.recommendation.confidence} confidence</Badge>
                <Badge variant="secondary">{data.recommendation.status.replaceAll("_", " ")}</Badge>
              </div>
              {data.recommendation.evidence.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {data.recommendation.evidence.map((e, i) => (
                    <p key={i}>
                      • {e.recordType}:{e.recordId} — {e.description}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activity */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageSquare className="size-3.5" /> Activity
          </p>
          {data.activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No real LinkedIn message/reply activity yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    <Badge variant="outline" className="mr-1.5 text-[10px]">{a.type.replaceAll("_", " ")}</Badge>
                    {a.contactName}
                  </span>
                  <span className="text-muted-foreground">{new Date(a.occurredAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
