"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { markPartnerCommissionPaid } from "../_lib/referral-partner-actions";

/**
 * "Mark as paid" button for a single PENDING PartnerCommission row — the
 * simple per-commission payout confirmation the spec asks for (deliberately
 * not a separate batch-Payout model/UI, which would be scope creep beyond
 * what the schema supports). Same useTransition + toast + router.refresh()
 * pattern as ActivatePartnerButton.
 */
export function MarkCommissionPaidButton({ commissionId }: { commissionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleMarkPaid() {
    startTransition(async () => {
      const result = await markPartnerCommissionPaid(commissionId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not mark this commission as paid.");
        return;
      }
      toast.success("Commission marked as paid.");
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleMarkPaid} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDollarSign className="size-3.5" />}
      Mark as paid
    </Button>
  );
}
