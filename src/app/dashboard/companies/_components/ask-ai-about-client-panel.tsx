"use client";

import { useState, useTransition } from "react";
import { Sparkles, MessageCircleQuestion } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { askAboutClientAction } from "../_lib/client-360-actions";
import type { AskAiAnswer } from "@/lib/business-development/client-360";

const SUGGESTED = ["What is pending?", "What did the client ask?", "What objections did they raise?", "When did they last reply?", "What should we do next?"];

const CONFIDENCE_VARIANT: Record<string, "outline" | "accent" | "secondary"> = {
  CONFIRMED: "accent",
  INFERRED: "secondary",
  UNKNOWN: "outline",
};

/**
 * Phase 5 §16-18 — "Ask AI About This Client". Every answer comes from
 * askAboutClientAction, which is grounded strictly in this company's real
 * stored records (never general knowledge) and always returns a real
 * confidence level + real supporting record references, never fabricated.
 */
export function AskAiAboutClientPanel({ companyId }: { companyId: string }) {
  const [isPending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  function ask(q: string) {
    setError(null);
    setAnswer(null);
    startTransition(async () => {
      const result = await askAboutClientAction(companyId, q);
      if (!result.ok) return setError(result.error ?? "Failed to get an answer.");
      setAnswer(result.data ?? null);
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleQuestion className="size-4" /> Ask AI about this client
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((q) => (
            <Button key={q} size="sm" variant="outline" className="text-xs" onClick={() => ask(q)} disabled={isPending}>
              {q}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about this client..."
            onKeyDown={(e) => e.key === "Enter" && question.trim() && ask(question)}
          />
          <Button size="sm" className="gap-1.5" onClick={() => ask(question)} disabled={isPending || !question.trim()}>
            <Sparkles className="size-3.5" /> Ask
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {isPending && <p className="text-xs text-muted-foreground">Thinking…</p>}

        {answer && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-1.5">
              <Badge variant={CONFIDENCE_VARIANT[answer.confidence]}>{answer.confidence}</Badge>
            </div>
            <p className="text-sm text-foreground">{answer.answer}</p>
            {answer.supportingRecords.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-foreground">Supporting records</p>
                {answer.supportingRecords.map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {r.recordType}:{r.recordId} — {r.label}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
