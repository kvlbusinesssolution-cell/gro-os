"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { publishDeal, archiveDeal } from "../_lib/deal-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

export function DealRowActions({ dealId, status }: { dealId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function publish() {
    startTransition(async () => {
      const result = await publishDeal(dealId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not post this deal.");
        return;
      }
      toast.success("Deal posted.");
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const result = await archiveDeal(dealId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not archive this deal.");
        return;
      }
      router.refresh();
    });
  }

  if (status === "PUBLISHED") {
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={archive}>
        Archive
      </Button>
    );
  }
  if (status === "ARCHIVED" || status === "EXPIRED") return null;

  return (
    <Button type="button" size="sm" disabled={pending} onClick={publish}>
      {pending ? "Posting…" : `Post (${GROWTH_TOKEN_COST.DEAL_POST} tokens)`}
    </Button>
  );
}
