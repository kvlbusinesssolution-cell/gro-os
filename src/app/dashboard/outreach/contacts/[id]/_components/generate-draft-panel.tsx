"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AiErrorBanner, type AIErrorKind } from "@/app/board/_components/ai-error-banner";
import { generateDraftForContact } from "@/app/dashboard/outreach/_lib/draft-actions";
import type { DraftChannel, DraftPurpose, EmailTone } from "@/generated/prisma/client";

const PURPOSE_OPTIONS: Array<{ value: DraftPurpose; label: string }> = [
  { value: "INTRODUCTION", label: "Introduction" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "MEETING_REQUEST", label: "Meeting request" },
  { value: "PRODUCT_INTRODUCTION", label: "Product introduction" },
  { value: "PROPOSAL_REQUEST", label: "Proposal request" },
  { value: "CASE_STUDY", label: "Case study" },
  { value: "THANK_YOU", label: "Thank you" },
  { value: "REMINDER", label: "Reminder" },
  { value: "RE_ENGAGEMENT", label: "Re-engagement" },
  { value: "CONNECTION_REQUEST", label: "Connection request (LinkedIn)" },
  { value: "CONVERSATION_SUMMARY", label: "Conversation summary (LinkedIn)" },
];

const TONE_OPTIONS: Array<{ value: EmailTone; label: string }> = [
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "FRIENDLY", label: "Friendly" },
  { value: "FORMAL", label: "Formal" },
  { value: "CONSULTATIVE", label: "Consultative" },
];

export function GenerateDraftPanel({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [purpose, setPurpose] = useState<DraftPurpose>("INTRODUCTION");
  const [tone, setTone] = useState<EmailTone>("PROFESSIONAL");
  const [channel, setChannel] = useState<DraftChannel>("EMAIL");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AIErrorKind>(undefined);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateDraftForContact(contactId, purpose, tone, channel);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        setErrorKind(result.errorKind);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Generate a draft
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {error && <AiErrorBanner error={error} kind={errorKind} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as DraftChannel)} className="h-9 text-sm">
            <option value="EMAIL">Email</option>
            <option value="LINKEDIN">LinkedIn</option>
            <option value="WHATSAPP">WhatsApp</option>
          </Select>
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value as DraftPurpose)} className="h-9 text-sm">
            {PURPOSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select value={tone} onChange={(e) => setTone(e.target.value as EmailTone)} className="h-9 text-sm">
            {TONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={handleGenerate} disabled={pending}>
          {pending ? "Drafting…" : "Generate draft"}
        </Button>
      </CardContent>
    </Card>
  );
}
