"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { composeEmail } from "@/app/dashboard/outreach/_lib/compose-actions";

interface ComposeContact {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  company: { name: string } | null;
}

interface ComposeFormProps {
  contacts: ComposeContact[];
}

function contactLabel(contact: ComposeContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const company = contact.company?.name;
  return `${name} <${contact.email}>${company ? ` — ${company}` : ""}`;
}

export function ComposeForm({ contacts }: ComposeFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  function handleSubmit(e: React.FormEvent) {
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
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

              {error && <p className="text-sm text-destructive">{error}</p>}

              <p className="text-xs text-muted-foreground">
                This creates a draft — you&apos;ll still need to approve and queue it before it sends, same as every
                other outreach email.
              </p>

              <div className="flex gap-3">
                <Button type="submit" disabled={pending || !contactId || !subject.trim() || !body.trim()}>
                  <Send className="size-4" /> {pending ? "Saving draft…" : "Save draft"}
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
