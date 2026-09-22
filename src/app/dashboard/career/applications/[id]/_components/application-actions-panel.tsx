"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";

import { approveApplication, retryApplication, withdrawApplication } from "../../../_lib/application-actions";

export function ApplicationActionsPanel({ applicationId, status }: { applicationId: string; status: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canApprove = status === "READY_FOR_REVIEW" || status === "USER_APPROVAL_REQUIRED";
  const canRetry = status === "FAILED_REQUIRES_REVIEW";
  const canWithdraw = !["WITHDRAWN", "CLOSED", "CONFIRMED", "REJECTED"].includes(status);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(() => {
      void action().then((result) => {
        if (!result.ok) setError(result.error ?? "Action failed.");
        else router.refresh();
      });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {canApprove && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => approveApplication(applicationId))}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <CheckCircle2 className="size-3.5" /> Approve &amp; submit
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => retryApplication(applicationId))}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" /> Retry
          </button>
        )}
        {canWithdraw && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => withdrawApplication(applicationId))}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <XCircle className="size-3.5" /> Withdraw
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
