import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Building2, Reply as ReplyIcon, MessageSquareOff } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { getContactTimeline } from "@/lib/outreach/inbox";
import { DraftCard } from "../../_components/draft-card";

const SENTIMENT_VARIANT: Record<string, "default" | "secondary" | "outline" | "accent"> = {
  POSITIVE: "accent",
  NEUTRAL: "outline",
  NEGATIVE: "secondary",
};

export default async function InboxThreadPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/outreach/inbox/${contactId}`);
  const organizationId = membership.organizationId;
  const canApprove = membership.role === "OWNER" || membership.role === "ADMIN";

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { company: { select: { id: true, name: true } } },
  });

  // Defense in depth: never trust the URL param alone — verify the contact
  // belongs to this org's membership before asking the timeline library for
  // its data (which also scopes by organizationId itself).
  if (!contact || contact.organizationId !== organizationId) {
    notFound();
  }

  const timeline = await getContactTimeline(organizationId, contactId);
  const name = `${contact.firstName} ${contact.lastName ?? ""}`.trim();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link
          href="/dashboard/outreach/inbox"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Inbox
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{name || contact.email}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5" /> {contact.email}
            </span>
            {contact.company && (
              <Link
                href={`/dashboard/companies/${contact.company.id}`}
                className="flex items-center gap-1.5 text-primary hover:underline"
              >
                <Building2 className="size-3.5" /> {contact.company.name}
              </Link>
            )}
          </div>
        </div>

        {timeline.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <MessageSquareOff className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No email conversation with {name || "this contact"} yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {timeline.map((event) =>
              event.type === "DRAFT" ? (
                <div key={`draft-${event.draft.id}`} className="flex flex-col gap-1 md:ml-auto md:w-full md:max-w-2xl">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">We sent</p>
                  <DraftCard draft={event.draft} canApprove={canApprove} />
                </div>
              ) : (
                <div key={`reply-${event.reply.id}`} className="flex flex-col gap-1 md:mr-auto md:w-full md:max-w-2xl">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <ReplyIcon className="size-3.5" /> {name || "Prospect"} replied
                  </p>
                  <Card className="border-l-4 border-l-primary/50 bg-muted/20">
                    <CardContent className="flex flex-col gap-1.5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge variant="outline">{event.reply.channel}</Badge>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {event.reply.sentiment && (
                            <Badge variant={SENTIMENT_VARIANT[event.reply.sentiment] ?? "outline"}>
                              {event.reply.sentiment} · AI-inferred
                            </Badge>
                          )}
                          {event.reply.intent && <Badge variant="outline">{event.reply.intent.replace(/_/g, " ")}</Badge>}
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-foreground/90">{event.reply.content}</p>
                      <p className="text-xs text-muted-foreground">{new Date(event.reply.receivedAt).toLocaleString()}</p>
                      {event.reply.suggestedResponse && (
                        <div className="mt-1 rounded-lg border border-border bg-muted/30 p-2.5">
                          <p className="text-xs font-medium text-foreground">AI-suggested reply</p>
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.reply.suggestedResponse}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ),
            )}
          </div>
        )}
      </Container>
    </main>
  );
}
