"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { submitReview } from "../_lib/public-actions";

export function ReviewForm({ listingId }: { listingId: string }) {
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [reviewerName, setReviewerName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await submitReview(listingId, { reviewerName, rating, title, body, companyWebsite });
      if (!result.ok) {
        toast.error(result.error ?? "Could not submit your review.");
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return <p className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">Thanks — your review will appear once it&apos;s been checked.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Leave a review</h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} className="p-0.5">
            <Star className={cn("size-5", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      <Input placeholder="Your name" value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} required />
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="Share your real experience" value={body} onChange={(e) => setBody(e.target.value)} />
      <input
        type="text"
        value={companyWebsite}
        onChange={(e) => setCompanyWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 opacity-0"
      />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Submitting…" : "Submit review"}
      </Button>
    </form>
  );
}
