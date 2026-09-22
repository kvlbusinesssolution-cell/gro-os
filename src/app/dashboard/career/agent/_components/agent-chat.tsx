"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { askCareerAgentAction } from "../_lib/agent-actions";

const SUGGESTED_QUESTIONS = [
  "What roles am I targeting?",
  "What skills are in my profile?",
  "Which resume is active?",
  "What preferences have I configured?",
  "What information is missing from my profile?",
];

export function AgentChat({ profiles }: { profiles: Array<{ id: string; name: string }> }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ answer?: string; groundedIn?: string[]; error?: string } | null>(null);

  function ask(q: string) {
    if (!profileId) return;
    setQuestion(q);
    setResult(null);
    startTransition(async () => {
      const res = await askCareerAgentAction(profileId, q);
      setResult(res.ok ? { answer: res.answer, groundedIn: res.groundedIn } : { error: res.error });
    });
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <p className="text-sm font-medium text-foreground">Ask about your career profile</p>
        </div>

        <Select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="w-64">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              disabled={isPending || !profileId}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about your profile…" className="flex-1" />
          <button
            type="submit"
            disabled={isPending || !profileId}
            className="rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "Thinking…" : "Ask"}
          </button>
        </form>

        {result?.error && <p className="text-sm text-destructive">{result.error}</p>}
        {result?.answer && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm text-foreground">{result.answer}</p>
            {result.groundedIn && result.groundedIn.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {result.groundedIn.map((g, i) => (
                  <Badge key={i} variant="outline">
                    {g}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
