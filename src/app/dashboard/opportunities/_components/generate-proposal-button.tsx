"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, FileText, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { generateProposalFromOpportunity } from "../_lib/proposal-generation-actions";

/**
 * "Generate Proposal" affordance on the opportunity detail page. Mirrors
 * opportunity-outreach-button.tsx's exact useTransition + toast +
 * router.refresh() pattern (same directory) and its toast `action` link
 * convention.
 *
 * "Already has a proposal" is durable server state — a real query on the
 * opportunity detail page (`prisma.proposal.findFirst` keyed off this
 * opportunity's `companyId`, the same key `generateProposalFromOpportunityCore`
 * stamps onto every `Proposal` it creates), not local component state, so a
 * page reload always reflects the truth and repeat clicks can never spam
 * duplicate Proposals from this button.
 */
export function GenerateProposalButton({
  opportunityId,
  isDismissed,
  existingProposalId,
}: {
  opportunityId: string;
  isDismissed: boolean;
  existingProposalId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateProposalFromOpportunity(opportunityId);

      if (!result.ok) {
        // Surface the real, specific error the action returned — never a
        // generic "something went wrong". This includes the honest "no
        // PROPOSAL agent configured for this org" / "not connected" /
        // "no API credits" cases exactly as the action reports them.
        toast.error(result.error ?? "Could not generate a proposal for this opportunity.");
        router.refresh();
        return;
      }

      toast.success("Proposal drafted from this opportunity.", {
        description: "Nothing was sent. Review it in the Proposal hub before it can go out.",
        action: result.proposalId
          ? {
              label: "View proposal",
              onClick: () => router.push(`/dashboard/proposal/proposals/${result.proposalId}`),
            }
          : undefined,
      });
      router.refresh();
    });
  }

  if (existingProposalId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/dashboard/proposal/proposals/${existingProposalId}`}>
          <ArrowUpRight className="size-3.5" /> View proposal
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleGenerate} disabled={pending || isDismissed}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        Generate proposal
      </Button>
      {isDismissed && (
        <p className="max-w-56 text-right text-xs text-muted-foreground">
          <FileText className="mr-1 inline size-3 align-text-bottom" />
          This opportunity was dismissed and can&apos;t be turned into a proposal.
        </p>
      )}
    </div>
  );
}
