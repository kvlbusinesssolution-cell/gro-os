"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Native Web Share API where available (mobile browsers — shares to WhatsApp/social directly), falling back to copy-link everywhere else. */
export function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled the native share sheet — fall through to nothing
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently no-op, not worth surfacing an error toast for a share button
    }
  }

  return (
    <Button type="button" variant="outline" onClick={share} className="gap-1.5">
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
