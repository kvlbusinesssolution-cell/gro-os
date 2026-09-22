"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Archive } from "lucide-react";

import { setPrimaryCareerProfile, archiveCareerProfile } from "../../../_lib/career-profile-actions";

export function ProfileActionsBar({ careerProfileId, isPrimary }: { careerProfileId: string; isPrimary: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {!isPrimary && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              void setPrimaryCareerProfile(careerProfileId);
            })
          }
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Star className="size-3.5" /> Set as primary
        </button>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await archiveCareerProfile(careerProfileId);
            router.push("/dashboard/career");
          })
        }
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Archive className="size-3.5" /> Archive profile
      </button>
    </div>
  );
}
