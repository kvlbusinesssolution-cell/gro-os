"use client";

import { useTransition } from "react";
import { Check, X, Clock, RefreshCw } from "lucide-react";

import { decideInterviewAction } from "../../../_lib/interview-actions";

export function InterviewDecisionActions({ interviewId }: { interviewId: string }) {
  const [isPending, startTransition] = useTransition();

  function decide(decision: "ACCEPT" | "REJECT" | "SUGGEST_ALTERNATIVE" | "REQUEST_ANOTHER_SLOT") {
    startTransition(() => {
      void decideInterviewAction(interviewId, decision);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={isPending} onClick={() => decide("ACCEPT")} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
        <Check className="size-3.5" /> Accept
      </button>
      <button type="button" disabled={isPending} onClick={() => decide("REJECT")} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50">
        <X className="size-3.5" /> Reject
      </button>
      <button type="button" disabled={isPending} onClick={() => decide("SUGGEST_ALTERNATIVE")} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50">
        <RefreshCw className="size-3.5" /> Suggest alternative
      </button>
      <button type="button" disabled={isPending} onClick={() => decide("REQUEST_ANOTHER_SLOT")} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50">
        <Clock className="size-3.5" /> Request another slot
      </button>
    </div>
  );
}
