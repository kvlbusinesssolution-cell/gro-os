"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { resolveReport } from "../actions";

export function ReportRowActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function resolve(status: "REVIEWED" | "DISMISSED") {
    startTransition(async () => {
      const result = await resolveReport(reportId, status);
      if (!result.ok) {
        toast.error(result.error ?? "Could not update this report.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => resolve("REVIEWED")}>
        Mark reviewed
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => resolve("DISMISSED")}>
        Dismiss
      </Button>
    </div>
  );
}
