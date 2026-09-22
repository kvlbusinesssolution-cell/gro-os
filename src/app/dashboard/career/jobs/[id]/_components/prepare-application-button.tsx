"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { prepareApplication } from "../../../_lib/application-actions";

export function PrepareApplicationButton({ careerProfileId, jobMatchId, existingApplicationId }: { careerProfileId: string; jobMatchId: string; existingApplicationId: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (existingApplicationId) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/dashboard/career/applications/${existingApplicationId}`)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <FileText className="size-3.5" /> View application
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(() => {
            void prepareApplication(careerProfileId, jobMatchId).then((result) => {
              if (!result.ok) {
                setError(result.error ?? "Could not prepare an application.");
                return;
              }
              if (result.applicationId) router.push(`/dashboard/career/applications/${result.applicationId}`);
            });
          });
        }}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <FileText className="size-3.5" /> {isPending ? "Preparing…" : "Prepare application"}
      </button>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
