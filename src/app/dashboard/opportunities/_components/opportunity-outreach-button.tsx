"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Loader2, Mail, Send, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { convertOpportunityToOutreach } from "../_lib/opportunity-outreach-actions";

/**
 * Phase 5 — "Convert to Outreach" affordance on the opportunity detail page.
 * Mirrors opportunity-actions.tsx's exact useTransition + toast +
 * router.refresh() pattern (same directory), and the toast `action` link
 * convention from run-now-button.tsx
 * (automation/workflows/[id]/_components/run-now-button.tsx).
 *
 * Every real id this shows a link for (contact/draft) comes straight from
 * either `convertOpportunityToOutreach`'s own return value or a real
 * server-side query on the page (see opportunities/[id]/page.tsx) — never
 * fabricated. "Already converted" is durable server state (a real Contact +
 * EmailDraft already exist for this opportunity's matched decision-maker),
 * not local component state, so a page reload always reflects the truth.
 */
export function OpportunityOutreachButton({
  opportunityId,
  hasDecisionMaker,
  alreadyConverted,
  existingContactId,
}: {
  opportunityId: string;
  hasDecisionMaker: boolean;
  alreadyConverted: boolean;
  existingContactId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleConvert(channel: "EMAIL" | "LINKEDIN") {
    startTransition(async () => {
      const result = await convertOpportunityToOutreach(opportunityId, channel);

      if (!result.ok) {
        // Surface the real, specific error the action returned — never a
        // generic "something went wrong". When a Contact/Sequence were
        // still durably created before the draft step failed, offer a real
        // link to them rather than silently discarding that fact.
        toast.error(result.error ?? "Could not convert this opportunity to outreach.", {
          description: result.contactId
            ? "A contact and sequence were still set up — you can generate a draft for them directly."
            : undefined,
          action: result.contactId
            ? {
                label: "View contact",
                onClick: () => router.push(`/dashboard/outreach/contacts/${result.contactId}`),
              }
            : undefined,
        });
        router.refresh();
        return;
      }

      toast.success(
        channel === "LINKEDIN"
          ? "Converted to outreach — first LinkedIn connection request drafted."
          : "Converted to outreach — first draft generated.",
        {
          description: "Nothing was sent. Review and approve the draft in Outreach before it can go out.",
          action: result.contactId
            ? {
                label: "View draft",
                onClick: () => router.push(`/dashboard/outreach/contacts/${result.contactId}`),
              }
            : undefined,
        },
      );
      router.refresh();
    });
  }

  if (alreadyConverted && existingContactId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/dashboard/outreach/contacts/${existingContactId}`}>
          <ArrowUpRight className="size-3.5" /> Already converted — view draft
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex">
        <Button
          size="sm"
          className="rounded-r-none"
          onClick={() => handleConvert("EMAIL")}
          disabled={pending || !hasDecisionMaker}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Convert to outreach
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="rounded-l-none border-l border-l-background/20 px-2"
              disabled={pending || !hasDecisionMaker}
              aria-label="Choose first-touch channel"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleConvert("EMAIL")} disabled={pending || !hasDecisionMaker}>
              <Mail className="size-3.5" /> Convert to outreach (Email)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleConvert("LINKEDIN")} disabled={pending || !hasDecisionMaker}>
              <UserPlus className="size-3.5" /> Convert to outreach (LinkedIn)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!hasDecisionMaker && (
        <p className="max-w-56 text-right text-xs text-muted-foreground">No public decision-maker identified yet.</p>
      )}
    </div>
  );
}
