"use client";

import { useState, useTransition } from "react";
import { Phone, ShieldCheck, ShieldAlert, History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getVoiceEligibilityAction,
  placeVoiceCallAction,
  captureVoiceConsentAction,
  updateCallOutcomeAction,
} from "../../../_lib/voice-actions";
import type { Call, CallOutcome, VoiceConsentStatus, VoiceRecordingConsent } from "@/generated/prisma/client";
import type { VoiceEligibilityResult } from "@/lib/outreach/voice-eligibility";

const ELIGIBILITY_VARIANT: Record<string, "accent" | "secondary" | "outline"> = {
  ELIGIBLE: "accent",
  CONSENT_REQUIRED: "secondary",
  DO_NOT_CALL: "outline",
  OPTED_OUT: "outline",
  INVALID_NUMBER: "outline",
  OUTSIDE_ALLOWED_TIME: "secondary",
  PROVIDER_RESTRICTED: "outline",
  JURISDICTION_RESTRICTED: "outline",
  UNKNOWN: "outline",
};

const OUTCOME_OPTIONS: CallOutcome[] = ["INTERESTED", "NOT_INTERESTED", "CALLBACK", "MEETING_REQUESTED", "QUALIFIED", "DISQUALIFIED"];

/**
 * Phase 10 (AI Voice Sales Engine) §54 — the real eligibility/consent gate
 * is always shown before a call can ever be placed; "Call now" is disabled
 * entirely unless the real, freshly-checked status is ELIGIBLE — never a
 * stale or assumed status.
 */
export function VoiceCallPanel({ contactId, initialEligibility, initialCalls }: { contactId: string; initialEligibility: VoiceEligibilityResult; initialCalls: Call[] }) {
  const [isPending, startTransition] = useTransition();
  const [eligibility, setEligibility] = useState(initialEligibility);
  const [calls, setCalls] = useState(initialCalls);
  const [message, setMessage] = useState<string | null>(null);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  const [consentEvidence, setConsentEvidence] = useState("");
  const [recordingConsent, setRecordingConsent] = useState<VoiceRecordingConsent>("UNKNOWN");

  function refreshEligibility() {
    startTransition(async () => {
      const result = await getVoiceEligibilityAction(contactId);
      if (result.ok && result.data) setEligibility(result.data);
    });
  }

  function placeCall() {
    setMessage(null);
    startTransition(async () => {
      const result = await placeVoiceCallAction(contactId);
      if (!result.ok) return setMessage(result.error ?? "Call failed.");
      setMessage(result.data?.error ?? (result.data?.ok ? "Call started." : "Call blocked."));
      if (result.data?.call) setCalls((prev) => [result.data!.call!, ...prev]);
      refreshEligibility();
    });
  }

  function saveConsent(status: VoiceConsentStatus) {
    if (!consentSource.trim() || !consentEvidence.trim()) return setMessage("A real source and evidence are required.");
    startTransition(async () => {
      const result = await captureVoiceConsentAction({ contactId, status, recordingConsent, source: consentSource, evidence: consentEvidence });
      if (!result.ok) return setMessage(result.error ?? "Failed to save consent.");
      setShowConsentForm(false);
      setMessage("Consent recorded.");
      refreshEligibility();
    });
  }

  function setOutcome(callId: string, outcome: CallOutcome) {
    startTransition(async () => {
      const result = await updateCallOutcomeAction(callId, outcome);
      if (!result.ok) return setMessage(result.error ?? "Failed to update outcome.");
      setCalls((prev) => prev.map((c) => (c.id === callId ? { ...c, outcome, outcomeSetBy: "HUMAN" } : c)));
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="size-4" /> AI Voice Call
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ELIGIBILITY_VARIANT[eligibility.status]}>{eligibility.status.replaceAll("_", " ")}</Badge>
          <Badge variant="outline" className="text-[10px]">Consent: {eligibility.consentStatus}</Badge>
          <Badge variant="outline" className="text-[10px]">Recording: {eligibility.recordingConsent.replaceAll("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground">{eligibility.phone ?? "No phone on file"}</span>
        </div>
        <p className="text-xs text-muted-foreground">{eligibility.detail}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={placeCall} disabled={isPending || eligibility.status !== "ELIGIBLE"}>
            <Phone className="size-3.5" /> Call now
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowConsentForm((v) => !v)} disabled={isPending}>
            <ShieldCheck className="size-3.5" /> Record consent
          </Button>
        </div>

        {showConsentForm && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ShieldAlert className="size-3.5" /> Real, auditable consent only — never a guess.
            </p>
            <Input placeholder="Source (e.g. 'Signed MSA clause 4.2', 'Verbal confirmation on call CALL_ID')" value={consentSource} onChange={(e) => setConsentSource(e.target.value)} />
            <Textarea placeholder="Evidence — what exactly happened, when" value={consentEvidence} onChange={(e) => setConsentEvidence(e.target.value)} rows={2} />
            <div className="flex flex-wrap gap-1.5">
              {(["RECORDING_ALLOWED", "RECORDING_REQUIRES_CONSENT", "RECORDING_NOT_ALLOWED"] as VoiceRecordingConsent[]).map((rc) => (
                <Badge key={rc} variant={recordingConsent === rc ? "accent" : "outline"} className="cursor-pointer text-[10px]" onClick={() => setRecordingConsent(rc)}>
                  {rc.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveConsent("GRANTED")} disabled={isPending}>Consent granted</Button>
              <Button size="sm" variant="outline" onClick={() => saveConsent("DENIED")} disabled={isPending}>Consent denied</Button>
            </div>
          </div>
        )}

        {message && <p className="text-xs text-muted-foreground">{message}</p>}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="size-3.5" /> Call history
          </p>
          {calls.length === 0 ? (
            <p className="text-xs text-muted-foreground">No real calls yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {calls.map((call) => (
                <div key={call.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{call.status.replaceAll("_", " ")}</Badge>
                    {call.outcome && (
                      <Badge variant="secondary">
                        {call.outcome.replaceAll("_", " ")} ({call.outcomeSetBy})
                      </Badge>
                    )}
                    <span className="text-muted-foreground">{new Date(call.createdAt).toLocaleString()}</span>
                  </div>
                  {call.cancelReason && <p className="text-muted-foreground">{call.cancelReason}</p>}
                  <p className="text-muted-foreground">
                    Transcript: {call.transcriptStatus.replaceAll("_", " ")} · Recording: {call.recordingStatus.replaceAll("_", " ")}
                  </p>
                  {call.status === "COMPLETED" && !call.outcome && (
                    <div className="flex flex-wrap gap-1">
                      {OUTCOME_OPTIONS.map((o) => (
                        <Badge key={o} variant="outline" className="cursor-pointer text-[10px]" onClick={() => setOutcome(call.id, o)}>
                          {o.replaceAll("_", " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
