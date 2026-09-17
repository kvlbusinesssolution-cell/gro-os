"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { activateReferralPartner } from "../_lib/referral-partner-actions";

/**
 * "Activate" button for a CANDIDATE (AI-discovered, not yet recruited)
 * referral partner — flips it to ACTIVE once a human operator has actually
 * recruited them. Mirrors opportunity-actions.tsx's exact useTransition +
 * toast + router.refresh() pattern. Only rendered by the caller when
 * `canManage` (OWNER/ADMIN) is true — see referral-partners/page.tsx and
 * [id]/page.tsx — but the server action re-checks the role itself too, so
 * this is a UI convenience, not the real gate.
 */
export function ActivatePartnerButton({ partnerId }: { partnerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleActivate() {
    startTransition(async () => {
      const result = await activateReferralPartner(partnerId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not activate this partner.");
        return;
      }
      toast.success("Partner activated.");
      router.refresh();
    });
  }

  return (
    <Button size="sm" onClick={handleActivate} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <UserCheck2 className="size-3.5" />}
      Activate
    </Button>
  );
}
