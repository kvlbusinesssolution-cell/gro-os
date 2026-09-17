"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createDraftFromSuggestedReplyAction } from "../../../_lib/suggested-reply-actions";

/**
 * Phase 6 — the human action point for a Reply's AI `suggestedResponse`.
 * Mirrors OpportunityOutreachButton's exact useTransition + toast +
 * router.refresh() pattern
 * (opportunities/_components/opportunity-outreach-button.tsx). Creates a
 * real EmailDraft at status "DRAFT" (createDraftFromSuggestedReply,
 * suggested-reply-draft.ts) and nothing more — no send affordance lives
 * here. The created draft shows up in the same Drafts tab / draft-card.tsx
 * review UI every other draft goes through (Review -> Approve -> Send),
 * which is the Drafts tab's default-open tab on this page already.
 */
export function SuggestedReplyButton({ replyId }: { replyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createDraftFromSuggestedReplyAction(replyId);

      if (!result.ok) {
        toast.error(result.error ?? "Could not create a draft from this suggestion.");
        return;
      }

      toast.success("Draft created from the AI's suggested reply.", {
        description: "Nothing was sent — review and approve it in the Drafts tab like any other draft.",
      });
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      Draft a reply from this suggestion
    </Button>
  );
}
