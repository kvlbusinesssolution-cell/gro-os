"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { downloadReputationCertificate } from "../_lib/reputation-certificate-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

function triggerBrowserDownload(base64: string, filename: string): void {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReputationCertificateButton({ listingId, hasReviews }: { listingId: string; hasReviews: boolean }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await downloadReputationCertificate(listingId);
      if (!result.ok || !result.pdfBase64 || !result.filename) {
        toast.error(result.error ?? "Could not generate this certificate.");
        return;
      }
      triggerBrowserDownload(result.pdfBase64, result.filename);
      toast.success("Reputation certificate downloaded.");
    });
  }

  if (!hasReviews) return null;

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={download}>
      {pending ? "Generating…" : `Download Reputation Certificate (${GROWTH_TOKEN_COST.REPUTATION_CERTIFICATE_DOWNLOAD} tokens)`}
    </Button>
  );
}
