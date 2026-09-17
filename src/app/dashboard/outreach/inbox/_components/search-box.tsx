import { Search } from "lucide-react";

/**
 * Real search box for the Email Center — a plain GET form (no client JS
 * needed) that submits `?q=` against `searchEmailCenter`. Submitting also
 * preserves the current `view` tab as a hidden field so switching tabs after
 * clearing the search box lands back where the user was.
 */
export function SearchBox({ defaultValue, view }: { defaultValue?: string; view: string }) {
  return (
    <form action="/dashboard/outreach/inbox" method="GET" className="relative min-w-[260px] flex-1">
      <input type="hidden" name="view" value={view} />
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search subjects, replies, contacts, companies, campaigns…"
        className="h-10 w-full rounded-lg border border-border bg-card/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </form>
  );
}
