"use client";

import { useTransition } from "react";
import { Bookmark, X } from "lucide-react";

import { setJobMatchStatus } from "../../../_lib/job-actions";

export function MatchActions({ jobMatchId, currentStatus }: { jobMatchId: string; currentStatus: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {currentStatus !== "SHORTLISTED" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              void setJobMatchStatus(jobMatchId, "SHORTLISTED");
            })
          }
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Bookmark className="size-3.5" /> Shortlist
        </button>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              void setJobMatchStatus(jobMatchId, "REVIEW_REQUIRED");
            })
          }
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <X className="size-3.5" /> Remove from shortlist
        </button>
      )}
    </div>
  );
}
