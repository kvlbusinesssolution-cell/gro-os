import Link from "next/link";
import { Mail, Reply as ReplyIcon, Building2, Circle } from "lucide-react";

import type { InboxThread } from "@/lib/outreach/inbox";

/** One row in the Inbox tab — a contact with the most recent SENT/REPLY activity. */
export function InboxThreadRow({ thread }: { thread: InboxThread }) {
  const { contact, lastMessage, unread } = thread;
  const name = `${contact.firstName} ${contact.lastName ?? ""}`.trim();

  return (
    <Link
      href={`/dashboard/outreach/inbox/${contact.id}`}
      className={`flex items-center gap-3 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-accent/50 ${
        unread ? "bg-primary/5" : ""
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {unread ? <Circle className="size-2 fill-primary text-primary" /> : null}
      </span>

      <span className="flex w-6 shrink-0 items-center justify-center text-muted-foreground">
        {lastMessage.kind === "REPLY" ? <ReplyIcon className="size-3.5" /> : <Mail className="size-3.5" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm ${unread ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
            {name || contact.email}
          </span>
          {contact.company && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="size-3" /> {contact.company.name}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {lastMessage.kind === "REPLY" ? "Replied: " : "You: "}
          {lastMessage.preview}
        </p>
      </div>

      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {new Date(lastMessage.at).toLocaleString()}
      </span>
    </Link>
  );
}
