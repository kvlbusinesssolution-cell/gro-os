"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { publishLandingPage, unpublishLandingPage, deleteLandingPage } from "../_lib/landing-page-actions";
import { GROWTH_TOKEN_COST } from "@/lib/billing/token-pricing";

export function PublishLandingPageButton({ landingPageId, status }: { landingPageId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function publish() {
    startTransition(async () => {
      const result = await publishLandingPage(landingPageId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not publish this page.");
        return;
      }
      toast.success("Page published.");
      router.refresh();
    });
  }

  function unpublish() {
    startTransition(async () => {
      const result = await unpublishLandingPage(landingPageId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not unpublish this page.");
        return;
      }
      toast.success("Page unpublished.");
      router.refresh();
    });
  }

  function remove() {
    if (!confirm("Delete this landing page permanently? This can't be undone.")) return;
    startTransition(async () => {
      const result = await deleteLandingPage(landingPageId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this page.");
        return;
      }
      toast.success("Page deleted.");
      router.push("/dashboard/marketing/landing-pages");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PUBLISHED" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={unpublish}>
          {pending ? "Working…" : "Unpublish"}
        </Button>
      ) : (
        <Button type="button" disabled={pending} onClick={publish}>
          {pending ? "Publishing…" : `Publish (${GROWTH_TOKEN_COST.LANDING_PAGE_PUBLISH} tokens)`}
        </Button>
      )}
      <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
        Delete
      </Button>
    </div>
  );
}
