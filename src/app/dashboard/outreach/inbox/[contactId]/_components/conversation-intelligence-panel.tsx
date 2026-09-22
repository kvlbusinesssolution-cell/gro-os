"use client";

import { useState, useTransition } from "react";
import { BrainCircuit, Sparkles, RefreshCw, Pencil } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  analyzeConversationAction,
  generateSuggestedReplyAction,
  overrideConversationIntelligenceAction,
} from "../../../_lib/conversation-intelligence-actions";
import type { ConversationIntelligence } from "@/generated/prisma/client";

const URGENCY_VARIANT: Record<string, "default" | "secondary" | "outline" | "accent"> = {
  CRITICAL: "secondary",
  HIGH: "secondary",
  MEDIUM: "outline",
  LOW: "outline",
  UNKNOWN: "outline",
};

const SENTIMENT_VARIANT: Record<string, "default" | "secondary" | "outline" | "accent"> = {
  POSITIVE: "accent",
  NEUTRAL: "outline",
  MIXED: "outline",
  NEGATIVE: "secondary",
  UNKNOWN: "outline",
};

type Summary = { status?: string; clientNeed?: string | null; objection?: string | null; timeline?: string | null; requestedService?: string | null; nextAction?: string | null };
type EvidenceItem = { value: string; sourceMessageId: string | null; classification: "CONFIRMED" | "INFERRED" };

/**
 * Phase 6 (AI Conversation Intelligence) — per-thread panel on the Inbox
 * thread page. Every value rendered comes straight from a real, persisted
 * ConversationIntelligence row (never computed client-side); "Re-analyze"
 * and "Suggest reply" trigger real server actions that never send anything
 * automatically — a suggested reply always lands as a DRAFT the human must
 * approve through the existing pipeline.
 */
export function ConversationIntelligencePanel({ contactId, initial }: { contactId: string; initial: ConversationIntelligence | null }) {
  const [isPending, startTransition] = useTransition();
  const [intelligence, setIntelligence] = useState<ConversationIntelligence | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [overriding, setOverriding] = useState(false);

  function reanalyze() {
    setMessage(null);
    startTransition(async () => {
      const result = await analyzeConversationAction(contactId);
      if (!result.ok) return setMessage(result.error ?? "Analysis failed.");
      if (result.data?.intelligence) setIntelligence(result.data.intelligence);
      setMessage(result.data?.reason ?? "Analysis complete.");
    });
  }

  function suggestReply() {
    setMessage(null);
    startTransition(async () => {
      const result = await generateSuggestedReplyAction(contactId);
      if (!result.ok || !result.data?.ok) return setMessage(result.data?.error ?? result.error ?? "Could not generate a suggested reply.");
      setMessage("Suggested reply drafted — review it in Drafts before sending.");
    });
  }

  function override(field: "detectedBuyingStage" | "intent" | "sentiment" | "urgency", currentValue: string) {
    const newValue = window.prompt(`Override ${field} (current: ${currentValue}):`, currentValue);
    if (!newValue || newValue === currentValue) return;
    const reason = window.prompt("Why are you overriding this?");
    if (!reason) return;
    setOverriding(true);
    startTransition(async () => {
      const result = await overrideConversationIntelligenceAction(contactId, field, newValue, reason);
      setOverriding(false);
      if (!result.ok) return setMessage(result.error ?? "Override failed.");
      if (result.data) setIntelligence(result.data);
      setMessage("Override saved.");
    });
  }

  if (!intelligence) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="size-4" /> Conversation Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-muted-foreground">No analysis yet for this thread.</p>
          <Button size="sm" className="w-fit gap-1.5" onClick={reanalyze} disabled={isPending}>
            <Sparkles className="size-3.5" /> Analyze conversation
          </Button>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>
    );
  }

  if (intelligence.status === "FAILED") {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="size-4" /> Conversation Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-destructive">Last analysis failed: {intelligence.error ?? "Unknown error."}</p>
          <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={reanalyze} disabled={isPending}>
            <RefreshCw className="size-3.5" /> Retry analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = intelligence.summary as Summary;
  const objections = intelligence.objections as EvidenceItem[];
  const requirements = intelligence.requirements as EvidenceItem[];

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BrainCircuit className="size-4" /> Conversation Intelligence
          </span>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={reanalyze} disabled={isPending}>
            <RefreshCw className="size-3.5" /> Re-analyze
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="cursor-pointer" onClick={() => override("intent", intelligence.intent)}>
            {intelligence.intent.replace(/_/g, " ")}
          </Badge>
          <Badge variant={SENTIMENT_VARIANT[intelligence.sentiment] ?? "outline"} className="cursor-pointer" onClick={() => override("sentiment", intelligence.sentiment)}>
            {intelligence.sentiment}
          </Badge>
          <Badge variant={URGENCY_VARIANT[intelligence.urgency] ?? "outline"} className="cursor-pointer" onClick={() => override("urgency", intelligence.urgency)}>
            {intelligence.urgency} urgency
          </Badge>
          {intelligence.detectedBuyingStage && (
            <Badge variant="outline" className="cursor-pointer" onClick={() => override("detectedBuyingStage", intelligence.detectedBuyingStage!)}>
              Stage read: {intelligence.detectedBuyingStage}
            </Badge>
          )}
          <Badge variant="outline">{intelligence.confidence} confidence</Badge>
          {intelligence.overriddenField && (
            <Badge variant="secondary" className="gap-1">
              <Pencil className="size-3" /> {intelligence.overriddenField} overridden
            </Badge>
          )}
        </div>

        {summary?.status && <p className="text-sm text-foreground">{summary.status}</p>}

        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {summary?.clientNeed && (
            <div>
              <p className="font-semibold text-foreground">Client need</p>
              <p className="text-muted-foreground">{summary.clientNeed}</p>
            </div>
          )}
          {summary?.timeline && (
            <div>
              <p className="font-semibold text-foreground">Timeline</p>
              <p className="text-muted-foreground">{summary.timeline}</p>
            </div>
          )}
          {summary?.requestedService && (
            <div>
              <p className="font-semibold text-foreground">Requested service</p>
              <p className="text-muted-foreground">{summary.requestedService}</p>
            </div>
          )}
          {summary?.nextAction && (
            <div>
              <p className="font-semibold text-foreground">Next action</p>
              <p className="text-muted-foreground">{summary.nextAction}</p>
            </div>
          )}
        </div>

        {requirements.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-foreground">Requirements (client-stated)</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {requirements.map((r, i) => (
                <li key={i}>
                  • {r.value} <span className="text-[10px] uppercase">({r.classification})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {objections.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-foreground">Objections</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {objections.map((o, i) => (
                <li key={i}>
                  • {o.value} <span className="text-[10px] uppercase">({o.classification})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button size="sm" className="w-fit gap-1.5" onClick={suggestReply} disabled={isPending}>
          <Sparkles className="size-3.5" /> Suggest a reply
        </Button>

        {(message || overriding) && <p className="text-xs text-muted-foreground">{overriding ? "Saving override…" : message}</p>}
      </CardContent>
    </Card>
  );
}
