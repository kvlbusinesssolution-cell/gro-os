"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AiErrorBanner, type AIErrorKind } from "@/app/board/_components/ai-error-banner";
import { generateMicrosite, publishMicrosite } from "../_lib/microsite-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

export function MicrositeActionsPanel({ listingId, micrositeId, status, hasPages }: { listingId: string; micrositeId: string | null; status: string | null; hasPages: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AIErrorKind>(undefined);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateMicrosite(listingId);
      if (!result.ok) {
        setError(result.error ?? "Could not generate your website.");
        setErrorKind(result.errorKind);
        return;
      }
      toast.success("Website draft generated — review and publish below.");
      router.refresh();
    });
  }

  function publish() {
    if (!micrositeId) return;
    startTransition(async () => {
      const result = await publishMicrosite(micrositeId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not publish this website.");
        return;
      }
      toast.success("Website published.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <AiErrorBanner error={error} kind={errorKind} />}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={generate}>
          {pending ? "Working…" : hasPages ? "Regenerate website draft" : "Generate my website (AI, free)"}
        </Button>
        {hasPages && status !== "PUBLISHED" && (
          <Button type="button" disabled={pending} onClick={publish}>
            {pending ? "Publishing…" : `Publish (${GROWTH_TOKEN_COST.MICROSITE_PUBLISH} tokens)`}
          </Button>
        )}
      </div>
    </div>
  );
}
