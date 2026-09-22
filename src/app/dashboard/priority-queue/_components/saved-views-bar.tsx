"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bookmark, Loader2, X } from "lucide-react";

import { toast } from "@/components/ui/toast";
import { deletePriorityQueueView, type PriorityQueueView } from "../actions";

function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  const str = search.toString();
  return str ? `/dashboard/priority-queue?${str}` : "/dashboard/priority-queue";
}

function isActive(view: PriorityQueueView, activeParams: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(view.params), ...Object.keys(activeParams)]);
  for (const key of keys) {
    if ((view.params[key] ?? "") !== (activeParams[key] ?? "")) return false;
  }
  return true;
}

/** Row of saved-view chips above the filter bar — click to jump straight to that filter combination, × to delete. */
export function SavedViewsBar({ views, activeParams }: { views: PriorityQueueView[]; activeParams: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (views.length === 0) return null;

  function handleDelete(id: string, name: string) {
    startTransition(async () => {
      const result = await deletePriorityQueueView(id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this view.");
        return;
      }
      toast.success(`Deleted "${name}".`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Bookmark className="size-3.5" /> Saved views:
      </span>
      {views.map((view) => {
        const active = isActive(view, activeParams);
        return (
          <div
            key={view.id}
            className={`group flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
              active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Link href={toQueryString(view.params)}>{view.name}</Link>
            <button
              type="button"
              onClick={() => handleDelete(view.id, view.name)}
              disabled={pending}
              aria-label={`Delete view ${view.name}`}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
