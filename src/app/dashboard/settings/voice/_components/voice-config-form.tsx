"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { setVoiceFromNumberAction, setAiDisclosureScriptAction } from "../_lib/voice-settings-actions";

export function VoiceFromNumberForm({ currentValue }: { currentValue: string | null }) {
  const [value, setValue] = useState(currentValue ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setVoiceFromNumberAction(value);
      setMessage(result.ok ? "Saved." : (result.error ?? "Failed to save."));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="voice-from-number" className="text-xs font-medium text-foreground">Authorized caller ID (E.164)</label>
      <div className="flex gap-2">
        <Input id="voice-from-number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="+14155238886" />
        <Button size="sm" onClick={save} disabled={isPending}>Save</Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

export function AiDisclosureScriptForm({ currentValue }: { currentValue: string | null }) {
  const [value, setValue] = useState(currentValue ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setAiDisclosureScriptAction(value);
      setMessage(result.ok ? "Saved." : (result.error ?? "Failed to save."));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="ai-disclosure-script" className="text-xs font-medium text-foreground">AI-disclosure script (spoken first on every real call)</label>
      <Textarea id="ai-disclosure-script" value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="This call uses AI-assisted technology..." />
      <Button size="sm" className="w-fit" onClick={save} disabled={isPending}>Save</Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
