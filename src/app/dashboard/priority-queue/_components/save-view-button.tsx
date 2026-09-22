"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { savePriorityQueueView } from "../actions";

/**
 * "Save this view" — persists the current filter querystring (everything
 * except pagination/`view` itself) as a named view via savePriorityQueueView,
 * reusing the existing SavedSearch table. `params` is computed server-side
 * in page.tsx from the real searchParams already applied to this render, so
 * what gets saved is exactly what's on screen right now.
 */
export function SaveViewButton({ params }: { params: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSave() {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await savePriorityQueueView(name.trim(), params);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save this view.");
        return;
      }
      toast.success(`Saved view "${name.trim()}".`);
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  const hasFilters = Object.keys(params).length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!hasFilters} title={hasFilters ? "Save current filters as a view" : "Apply a filter first"}>
          <BookmarkPlus className="size-3.5" /> Save view
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>Name this filter combination so you can jump back to it later without re-picking every dropdown.</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hot leads in Healthcare"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="size-3.5 animate-spin" />} Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
