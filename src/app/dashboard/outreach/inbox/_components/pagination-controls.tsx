import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The one shared Prev/Next pagination component for every list in the Email
 * Center (Inbox, Sent, Drafts, Scheduled, Failed, Threads, AI Generated,
 * Campaign Emails, and Search results) — avoids repeating the same JSX in
 * each tab's render function.
 *
 * `params` are the extra query params to preserve on the Prev/Next links
 * (e.g. `{ view: "sent", q: "acme" }`) — `page` is added/overwritten by this
 * component itself.
 */
export function PaginationControls({
  page,
  pageSize,
  totalCount,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (totalCount === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  function hrefForPage(targetPage: number) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) search.set(key, value);
    }
    search.set("page", String(targetPage));
    return `${basePath}?${search.toString()}`;
  }

  const linkBase =
    "flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Showing {start}–{end} of {totalCount}
      </p>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={hrefForPage(page - 1)} className={`${linkBase} text-foreground hover:bg-accent/50`}>
            <ChevronLeft className="size-3.5" /> Prev
          </Link>
        ) : (
          <span className={`${linkBase} pointer-events-none text-muted-foreground/40`}>
            <ChevronLeft className="size-3.5" /> Prev
          </span>
        )}
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        {hasNext ? (
          <Link href={hrefForPage(page + 1)} className={`${linkBase} text-foreground hover:bg-accent/50`}>
            Next <ChevronRight className="size-3.5" />
          </Link>
        ) : (
          <span className={`${linkBase} pointer-events-none text-muted-foreground/40`}>
            Next <ChevronRight className="size-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}
