"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { composeEmail, composeEmailWithAI } from "@/app/dashboard/outreach/_lib/compose-actions";

interface ComposeContact {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  company: {
    name: string;
    industry: string | null;
    leadOpportunities: Array<{ title: string; category: string; status: string }>;
  } | null;
  deals: Array<{ name: string; value: number | null }>;
  campaigns: Array<{ campaign: { name: string } }>;
  emailDrafts: Array<{ sequence: { name: string } | null }>;
}

interface ComposeFormProps {
  contacts: ComposeContact[];
}

function contactLabel(contact: ComposeContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const company = contact.company?.name;
  return `${name} <${contact.email}>${company ? ` — ${company}` : ""}`;
}

/**
 * Read-only "what's already linked to this contact" panel — Company,
 * Opportunity, Deal, Campaign, Sequence — all real, already-persisted data
 * pulled via the Contact the human already picked (see page.tsx's query).
 * Deliberately no separate manual-override pickers for these: every field
 * here is fully determined by the chosen Contact already, so a second set
 * of dropdowns would just be redundant surface area that could drift from
 * the real linkage.
 */
function ContactContextPanel({ contact }: { contact: ComposeContact }) {
  const opportunity = contact.company?.leadOpportunities[0];
  const deal = contact.deals[0];
  const campaign = contact.campaigns[0]?.campaign;
  const sequence = contact.emailDrafts[0]?.sequence;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Company", value: contact.company ? `${contact.company.name}${contact.company.industry ? ` (${contact.company.industry})` : ""}` : "Not linked to a company" },
    { label: "Opportunity", value: opportunity ? `${opportunity.title} — ${opportunity.category}` : "None on record" },
    { label: "Deal", value: deal ? `${deal.name}${deal.value ? ` (${deal.value.toLocaleString()})` : ""}` : "None on record" },
    { label: "Campaign", value: campaign ? campaign.name : "Not enrolled in a campaign" },
    { label: "Sequence", value: sequence ? sequence.name : "No sequence history" },
  ];

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <p className="mb-2 font-medium text-foreground">Linked context</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2 sm:justify-start">
            <dt className="text-muted-foreground">{row.label}:</dt>
            <dd className="text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ComposeForm({ contacts }: ComposeFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aiPending, startAiTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const selectedContact = useMemo(() => contacts.find((c) => c.id === contactId) ?? null, [contacts, contactId]);

  function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!contactId) {
      setError("Choose a contact to compose this email to.");
      return;
    }

    startTransition(async () => {
      const result = await composeEmail(contactId, subject, body);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong composing this draft.");
        return;
      }
      router.push(`/dashboard/outreach/inbox/${contactId}`);
    });
  }

  function handleSchedule() {
    setError(null);

    if (!contactId) {
      setError("Choose a contact to compose this email to.");
      return;
    }
    if (!scheduledFor) {
      setError("Pick a date/time to schedule this draft for.");
      return;
    }

    const scheduledDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledDate.getTime())) {
      setError("That scheduled date/time isn't valid.");
      return;
    }

    startTransition(async () => {
      const result = await composeEmail(contactId, subject, body, { scheduledFor: scheduledDate });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong scheduling this draft.");
        return;
      }
      router.push(`/dashboard/outreach/inbox/${contactId}`);
    });
  }

  function handleWriteWithAI() {
    setAiError(null);

    if (!contactId) {
      setAiError("Choose a contact first so Write with AI has something real to ground the draft in.");
      return;
    }

    startAiTransition(async () => {
      const result = await composeEmailWithAI(contactId, instructions.trim() || undefined);
      if (!result.ok) {
        setAiError(result.error ?? "Write with AI couldn't generate a draft.");
        return;
      }
      // Populates the fields for the human to review/edit — this never saves
      // anything by itself. Only "Save draft" / "Schedule" persist an
      // EmailDraft, same as if the human had typed this text themselves.
      setSubject(result.subject ?? "");
      setBody(result.body ?? "");
    });
  }

  const busy = pending || aiPending;

  return (
    <main className="py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4">
        <div>
          <Link
            href="/dashboard/outreach/inbox"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="size-4" /> Back to inbox
          </Link>
        </div>

        <Card glass className="w-full">
          <CardHeader>
            <CardTitle>Compose email</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveDraft} className="flex flex-col gap-4">
              <FormField label="Contact" htmlFor="compose-contact" required>
                {contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No contacts yet. Add a contact before composing an email.
                  </p>
                ) : (
                  <Select id="compose-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} required>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contactLabel(contact)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>

              {selectedContact && <ContactContextPanel contact={selectedContact} />}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="Cc"
                  htmlFor="compose-cc"
                  hint="Not yet supported by the current email provider integration — there's no cc column on drafts and Gmail/Outlook/Resend/SMTP sending doesn't accept one yet."
                >
                  <div title="Not yet supported by the current email provider integration — nothing typed here would be saved or sent, so it's disabled rather than silently dropped.">
                    <Input id="compose-cc" value="" disabled placeholder="Not yet supported" />
                  </div>
                </FormField>
                <FormField
                  label="Bcc"
                  htmlFor="compose-bcc"
                  hint="Not yet supported by the current email provider integration — same reason as Cc."
                >
                  <div title="Not yet supported by the current email provider integration — nothing typed here would be saved or sent, so it's disabled rather than silently dropped.">
                    <Input id="compose-bcc" value="" disabled placeholder="Not yet supported" />
                  </div>
                </FormField>
              </div>

              <FormField label="Subject" htmlFor="compose-subject" required>
                <Input
                  id="compose-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Following up on our conversation"
                  required
                />
              </FormField>

              <FormField label="Message" htmlFor="compose-body" required>
                <Textarea
                  id="compose-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your email…"
                  className="min-h-48"
                  required
                />
              </FormField>

              <div className="rounded-lg border border-border p-3">
                <FormField
                  label="Instructions for Write with AI"
                  htmlFor="compose-ai-instructions"
                  hint="Optional. e.g. &quot;mention the pricing question they raised&quot; — the AI only uses this to steer real, already-known facts about this contact, never to invent new ones."
                >
                  <Textarea
                    id="compose-ai-instructions"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Optional — anything you want the AI to focus on"
                    className="min-h-20"
                  />
                </FormField>
                <div className="mt-3 flex items-center gap-3">
                  <Button type="button" variant="secondary" onClick={handleWriteWithAI} disabled={busy || !contactId}>
                    <Sparkles className="size-4" /> {aiPending ? "Writing…" : "Write with AI"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Fills in Subject/Message above for you to review and edit — never saves or sends by itself.
                  </p>
                </div>
                {aiError && <p className="mt-2 text-sm text-destructive">{aiError}</p>}
              </div>

              <FormField
                label="Schedule for"
                htmlFor="compose-scheduled-for"
                hint="Optional. Leave blank to save as a normal draft — set this and use &quot;Schedule&quot; below to record the earliest real send time on the draft."
              >
                <Input
                  id="compose-scheduled-for"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </FormField>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <p className="text-xs text-muted-foreground">
                This creates a draft — you&apos;ll still need to approve and queue it before it sends, same as every
                other outreach email. There is no direct Send from Compose.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy || !contactId || !subject.trim() || !body.trim()}>
                  <Send className="size-4" /> {pending ? "Saving draft…" : "Save draft"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSchedule}
                  disabled={busy || !contactId || !subject.trim() || !body.trim() || !scheduledFor}
                >
                  <CalendarClock className="size-4" /> {pending ? "Saving…" : "Schedule"}
                </Button>
                <Link href="/dashboard/outreach/inbox">
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
