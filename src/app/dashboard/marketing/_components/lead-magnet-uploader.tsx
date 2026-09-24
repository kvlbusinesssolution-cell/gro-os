"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setLandingPageLeadMagnet } from "../_lib/landing-page-actions";

export function LeadMagnetUploader({ landingPageId, currentFilename }: { landingPageId: string; currentFilename: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    startTransition(async () => {
      const result = await setLandingPageLeadMagnet(landingPageId, file);
      if (!result.ok) {
        toast.error(result.error ?? "Could not upload this file.");
        return;
      }
      toast.success("Lead magnet uploaded — it will be offered to every submission.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {currentFilename && <span className="text-sm text-muted-foreground">Current: {currentFilename}</span>}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? "Uploading…" : currentFilename ? "Replace lead magnet" : "Upload a lead magnet (optional)"}
      </Button>
    </div>
  );
}
