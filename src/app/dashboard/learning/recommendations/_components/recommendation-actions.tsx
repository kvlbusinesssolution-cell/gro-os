"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { approveRecommendationAction, rejectRecommendationAction } from "../_lib/actions";

export function RecommendationActions({ recommendationId, canApprove }: { recommendationId: string; canApprove: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canApprove) {
    return <p className="text-[11px] text-muted-foreground">Only an OWNER or ADMIN can approve/reject.</p>;
  }

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveRecommendationAction(recommendationId);
      if (!result.ok) setError(result.error ?? "Failed to approve.");
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectRecommendationAction(recommendationId);
      if (!result.ok) setError(result.error ?? "Failed to reject.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={approve} disabled={isPending}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={reject} disabled={isPending}>
          <X className="size-3.5" /> Reject
        </Button>
      </div>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
