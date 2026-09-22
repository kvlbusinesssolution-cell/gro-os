import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Building2,
  Reply as ReplyIcon,
  MessageSquareOff,
  ChevronRight,
  Target,
  Handshake,
  FileText,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { getContactTimeline } from "@/lib/outreach/inbox";
import { getEmailCrmBreadcrumb } from "@/lib/outreach/email-crm-breadcrumb";
import { DraftCard } from "../../_components/draft-card";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { ConversationIntelligencePanel } from "./_components/conversation-intelligence-panel";
import { VoiceCallPanel } from "./_components/voice-call-panel";
import { checkVoiceEligibility } from "@/lib/outreach/voice-eligibility";

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

  const [timeline, breadcrumb, conversationIntelligence, voiceEligibility, calls] = await Promise.all([
    getContactTimeline(organizationId, contactId),
    getEmailCrmBreadcrumb(organizationId, contactId),
    prisma.conversationIntelligence.findFirst({ where: { organizationId, contactId }, orderBy: { generatedAt: "desc" } }),
    checkVoiceEligibility(organizationId, contactId),
    prisma.call.findMany({ where: { organizationId, contactId }, orderBy: { createdAt: "desc" } }),
  ]);
  const name = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const currency = membership.organization.currency;

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

        {breadcrumb && (
          <Card glass>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CRM Journey</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {/* Stage 1: Contact — always populated, this page's own subject. */}
                <Badge variant="accent" className="gap-1.5">
                  <Mail className="size-3.5" /> {name || contact.email}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />

                {/* Stage 2: Company */}
                {breadcrumb.company ? (
                  <Link href={`/dashboard/companies/${breadcrumb.company.id}`}>
                    <Badge variant="outline" className="gap-1.5 text-primary hover:underline">
                      <Building2 className="size-3.5" /> {breadcrumb.company.name}
                    </Badge>
                  </Link>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No company linked
                  </Badge>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />

                {/* Stage 3: Opportunity — show all, never silently pick one. */}
                {breadcrumb.leadOpportunities.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {breadcrumb.leadOpportunities.map((opp) => (
                      <Link key={opp.id} href={`/dashboard/opportunities/${opp.id}`}>
                        <Badge variant="outline" className="gap-1.5 text-primary hover:underline">
                          <Target className="size-3.5" /> {opp.title}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No opportunity detected yet
                  </Badge>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />

                {/* Stage 4: Deal — show all, never silently pick one. */}
                {breadcrumb.deals.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {breadcrumb.deals.map((deal) => (
                      <Link key={deal.id} href={`/dashboard/crm/deals/${deal.id}`}>
                        <Badge variant="outline" className="gap-1.5 text-primary hover:underline">
                          <Handshake className="size-3.5" /> {deal.name}
                          {deal.value != null ? ` · ${formatCurrency(deal.value, currency)}` : ""}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No deal yet
                  </Badge>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />

                {/* Stage 5: Proposal — show all, never silently pick one. */}
                {breadcrumb.proposals.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {breadcrumb.proposals.map((proposal) => (
                      <Link key={proposal.id} href={`/dashboard/proposal/proposals/${proposal.id}`}>
                        <Badge variant="outline" className="gap-1.5 text-primary hover:underline">
                          <FileText className="size-3.5" /> {proposal.title}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    No proposal yet
                  </Badge>
                )}
              </div>

              {(breadcrumb.campaign || breadcrumb.sequence) && (
                <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {breadcrumb.campaign && <span>Campaign: {breadcrumb.campaign.name}</span>}
                  {breadcrumb.sequence && <span>Sequence: {breadcrumb.sequence.name}</span>}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <ConversationIntelligencePanel contactId={contactId} initial={conversationIntelligence} />
        <VoiceCallPanel contactId={contactId} initialEligibility={voiceEligibility} initialCalls={calls} />

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
