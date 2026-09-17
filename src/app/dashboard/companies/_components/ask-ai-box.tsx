"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AiErrorBanner } from "@/app/board/_components/ai-error-banner";
import { askAiAboutClientAction } from "../[id]/_lib/ask-ai-actions";

interface Answer {
  question: string;
  answer: string;
  groundedIn: string[];
}

/** Real client-side "Ask AI about this client" box — posts to the session-gated askAiAboutClientAction, which delegates to the grounded askAiAboutClient core function. Never fabricates an answer client-side; every render is either a real AI response or an honest error/empty state. */
export function AskAiBox({ companyId }: { companyId: string }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await askAiAboutClientAction(companyId, trimmed);
      if (!result.ok || !result.answer) {
        setError(result.error ?? "Something went wrong asking AI about this client.");
        return;
      }
      setHistory((prev) => [{ question: trimmed, answer: result.answer!, groundedIn: result.groundedIn ?? [] }, ...prev]);
      setQuestion("");
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Ask AI about this client
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {error && <AiErrorBanner error={error} />}
        <div className="flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending) handleAsk();
            }}
            placeholder='e.g. "Has the client confirmed a budget yet?"'
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-3 text-sm outline-none focus:border-primary"
            disabled={pending}
          />
          <Button size="sm" onClick={handleAsk} disabled={pending || !question.trim()}>
            {pending ? "Thinking…" : (
              <span className="flex items-center gap-1.5">
                <Send className="size-3.5" /> Ask
              </span>
            )}
          </Button>
        </div>

        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ask a real question about this company&apos;s conversation history — answers are grounded only in real emails,
            replies, meetings, tasks, opportunities, proposals, deals, and evidence on file.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map((entry, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-foreground">{entry.question}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{entry.answer}</p>
                {entry.groundedIn.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.groundedIn.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
