"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recalculateIntentAction } from "../_lib/intent-actions";

/** Phase 2 (Buying Intent Intelligence Engine) — manual "recalculate intent now" trigger, session-gated/rate-limited/tenant-isolated via recalculateIntentAction. */
export function CompanyIntentRecalculateButton({ companyId }: { companyId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await recalculateIntentAction(companyId);
      if (!result.ok) {
        setError(result.error ?? "Recalculation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={handleClick} disabled={isPending}>
        <RefreshCw className={isPending ? "size-3.5 animate-spin" : "size-3.5"} />
        {isPending ? "Recalculating…" : "Recalculate intent"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
