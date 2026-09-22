import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, Building2, Sparkles, CalendarCheck } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { LeadScoreBadge } from "@/app/dashboard/_components/lead-score-badge";
import { OpportunityBandBadge } from "@/app/dashboard/website-scanner/_components/opportunity-band-badge";
import { DraftCard } from "../../_components/draft-card";
import { GenerateDraftPanel } from "./_components/generate-draft-panel";
import { FollowUpPanel } from "./_components/follow-up-panel";
import { LogReplyForm } from "./_components/log-reply-form";
import { RequestMeetingForm } from "./_components/request-meeting-form";
import { SuggestedReplyButton } from "./_components/suggested-reply-button";
import { checkWhatsAppEligibility } from "@/lib/outreach/whatsapp-eligibility";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/outreach/contacts/${id}`);

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      company: {
        include: {
          leadScore: true,
          intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
          websiteScans: { orderBy: { createdAt: "desc" }, take: 1, include: { opportunity: true } },
        },
      },
      emailDrafts: { orderBy: { createdAt: "desc" }, include: { approvals: { orderBy: { createdAt: "desc" } } } },
      replies: { orderBy: { receivedAt: "desc" } },
      outreachMeetings: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!contact || contact.organizationId !== membership.organizationId) {
    notFound();
  }

  const canApprove = membership.role === "OWNER" || membership.role === "ADMIN";
  const whatsappEligibility = contact.phone ? await checkWhatsAppEligibility(membership.organizationId, contact.id) : null;
  const intel = contact.company?.intelligenceRuns[0];
  const opportunity = contact.company?.websiteScans[0]?.opportunity;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link href="/dashboard/outreach/contacts" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to Contacts
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {contact.firstName} {contact.lastName ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">{contact.jobTitle}{contact.company ? ` at ${contact.company.name}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{contact.status.replace(/_/g, " ")}</Badge>
            {contact.company?.leadScore && <LeadScoreBadge band={contact.company.leadScore.band} score={contact.company.leadScore.overallScore} />}
            {opportunity && <OpportunityBandBadge band={opportunity.band} score={opportunity.overallOpportunityScore} />}
            {contact.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <GenerateDraftPanel contactId={contact.id} />

            <Tabs defaultValue="drafts">
              <TabsList>
                <TabsTrigger value="drafts">Drafts ({contact.emailDrafts.length})</TabsTrigger>
                <TabsTrigger value="replies">Replies ({contact.replies.length})</TabsTrigger>
                <TabsTrigger value="meetings">Meetings ({contact.outreachMeetings.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="drafts">
                <div className="flex flex-col gap-3">
                  {contact.emailDrafts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No drafts yet — generate one above.</p>
                  ) : (
                    contact.emailDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} canApprove={canApprove} />)
                  )}
                </div>
              </TabsContent>

              <TabsContent value="replies" className="flex flex-col gap-4">
                <LogReplyForm contactId={contact.id} />
                {contact.replies.map((reply) => (
                  <Card key={reply.id} glass>
                    <CardContent className="flex flex-col gap-1.5 p-4">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">{reply.channel}</Badge>
                        {reply.sentiment && <Badge variant="accent">{reply.sentiment} · AI-inferred</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{reply.content}</p>
                      <p className="text-xs text-muted-foreground">{new Date(reply.receivedAt).toLocaleString()}</p>
                      {reply.suggestedResponse && (
                        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                          <p className="flex items-center gap-1 text-xs font-medium text-foreground">
                            <Sparkles className="size-3.5 text-primary" /> AI-suggested reply
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{reply.suggestedResponse}</p>
                          <div>
                            <SuggestedReplyButton replyId={reply.id} />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="meetings" className="flex flex-col gap-4">
                <RequestMeetingForm contactId={contact.id} />
                {contact.outreachMeetings.map((meeting) => (
                  <Card key={meeting.id} glass>
                    <CardContent className="flex flex-col gap-2 p-4">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <CalendarCheck className="size-4" /> {meeting.title}
                        </p>
                        <Badge variant="outline">{meeting.status}</Badge>
                      </div>
                      {meeting.agenda && <p className="text-sm text-muted-foreground">{meeting.agenda}</p>}
                      {meeting.discussionTopics.length > 0 && (
                        <ul className="flex flex-col gap-0.5">
                          {meeting.discussionTopics.map((t, i) => (
                            <li key={i} className="text-xs text-muted-foreground before:mr-1.5 before:content-['•']">
                              {t}
                            </li>
                          ))}
                        </ul>
                      )}
                      {meeting.scheduledAt && (
                        <a href={`/api/outreach/meetings/${meeting.id}/ics`} className="w-fit text-xs text-primary hover:underline">
                          Download .ics calendar invite
                        </a>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex flex-col gap-4">
            <Card glass>
              <CardHeader>
                <CardTitle className="text-base">Contact info</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0 text-sm">
                <span className="flex items-center gap-2">
                  <Mail className="size-3.5 text-muted-foreground" /> {contact.email}
                </span>
                {contact.phone && (
                  <span className="flex items-center gap-2">
                    <Phone className="size-3.5 text-muted-foreground" /> {contact.phone}
                    {whatsappEligibility && (
                      <Badge variant={whatsappEligibility.status === "ELIGIBLE" || whatsappEligibility.status === "OPTED_IN" ? "accent" : "outline"} title={whatsappEligibility.detail}>
                        WhatsApp: {whatsappEligibility.status}
                      </Badge>
                    )}
                  </span>
                )}
                {contact.company && (
                  <Link href={`/dashboard/companies/${contact.company.id}`} className="flex items-center gap-2 text-primary hover:underline">
                    <Building2 className="size-3.5" /> {contact.company.name}
                  </Link>
                )}
              </CardContent>
            </Card>

            <FollowUpPanel contactId={contact.id} />

            {intel && (
              <Card glass>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4 text-primary" /> Company Intelligence <Badge variant="accent">AI-generated</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">{intel.businessSummary}</CardContent>
              </Card>
            )}
          </div>
        </div>
      </Container>
    </main>
  );
}
