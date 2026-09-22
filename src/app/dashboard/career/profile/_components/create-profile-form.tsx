"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createCareerProfile } from "../../_lib/career-profile-actions";

export function CreateProfileForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="text-sm font-medium text-foreground">Create a new career profile</p>
        <p className="text-xs text-muted-foreground">
          E.g. &quot;Senior React Developer&quot; or &quot;AI Engineer&quot; — each profile can have its own resume and preferences.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await createCareerProfile({ name });
              if (!result.ok) {
                setError(result.error ?? "Something went wrong.");
                return;
              }
              setName("");
              if (result.careerProfileId) router.push(`/dashboard/career/profile/${result.careerProfileId}`);
            });
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Profile name"
            className="w-64"
            required
          />
          <button
            type="submit"
            disabled={isPending}
            className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create profile"}
          </button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
