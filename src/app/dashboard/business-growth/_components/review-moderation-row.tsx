"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { approveReview, rejectReview, replyToReview } from "../_lib/review-moderation-actions";

export function ReviewModerationRow({
  review,
}: {
  review: {
    id: string;
    reviewerName: string;
    rating: number;
    title: string | null;
    body: string | null;
    status: string;
    ownerReplyBody?: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  function approve() {
    startTransition(async () => {
      const result = await approveReview(review.id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not approve this review.");
        return;
      }
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectReview(review.id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not reject this review.");
        return;
      }
      router.refresh();
    });
  }

  function submitReply() {
    startTransition(async () => {
      const result = await replyToReview(review.id, replyBody);
      if (!result.ok) {
        toast.error(result.error ?? "Could not post reply.");
        return;
      }
      setReplying(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={cn("size-4", n <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            ))}
            <span className="ml-2 text-sm font-medium text-foreground">{review.reviewerName}</span>
          </div>
          {review.title && <p className="text-sm font-medium text-foreground">{review.title}</p>}
          {review.body && <p className="text-sm text-muted-foreground">{review.body}</p>}
        </div>
        {review.status === "PENDING" && (
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={approve}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={reject}>
              Reject
            </Button>
          </div>
        )}
        {review.status !== "PENDING" && <span className="text-xs text-muted-foreground">{review.status}</span>}
      </div>

      {review.ownerReplyBody && !replying && (
        <div className="ml-4 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">Owner reply</p>
          <p className="text-sm text-muted-foreground">{review.ownerReplyBody}</p>
          <Button type="button" size="sm" variant="ghost" className="mt-1 h-auto px-0 text-xs" onClick={() => { setReplyBody(review.ownerReplyBody ?? ""); setReplying(true); }}>
            Edit reply
          </Button>
        </div>
      )}

      {review.status !== "PENDING" && !review.ownerReplyBody && !replying && (
        <Button type="button" size="sm" variant="ghost" className="ml-4 h-auto w-fit px-0 text-xs" onClick={() => setReplying(true)}>
          Reply
        </Button>
      )}

      {replying && (
        <div className="ml-4 flex flex-col gap-2">
          <Textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write a public reply…" rows={3} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={submitReply}>
              Post reply
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
