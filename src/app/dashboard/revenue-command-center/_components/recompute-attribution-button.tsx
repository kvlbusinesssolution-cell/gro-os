"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recomputeAttributionAction } from "../_lib/attribution-actions";

/** Manual, deterministic recompute trigger — see attribution-actions.ts's doc comment on why this never touches financial source-of-truth records. */
export function RecomputeAttributionButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function recompute() {
    setMessage(null);
    startTransition(async () => {
      const result = await recomputeAttributionAction();
      if (!result.ok) return setMessage(result.error ?? "Recompute failed.");
      setMessage(
        result.data
          ? `Recomputed ${result.data.computed}/${result.data.invoicesConsidered} paid invoice(s): ${result.data.direct} direct, ${result.data.assisted} assisted, ${result.data.unknown} unknown.`
          : "Done.",
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={recompute} disabled={isPending}>
        <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} /> Recompute Attribution
      </Button>
      {message && <p className="max-w-xs text-right text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
