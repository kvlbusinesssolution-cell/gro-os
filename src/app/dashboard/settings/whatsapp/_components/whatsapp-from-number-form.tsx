"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setWhatsAppFromNumberAction } from "../_lib/whatsapp-settings-actions";

export function WhatsAppFromNumberForm({ currentNumber, connected }: { currentNumber: string | null; connected: boolean }) {
  const [value, setValue] = useState(currentNumber ?? "");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setWhatsAppFromNumberAction(value);
      setMessage(result.ok ? "Saved." : (result.error ?? "Failed to save."));
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="whatsapp-from-number" className="text-xs font-medium text-foreground">
        WhatsApp sender number (E.164)
      </label>
      <div className="flex gap-2">
        <Input id="whatsapp-from-number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="+14155238886" disabled={!connected} className="max-w-xs" />
        <Button size="sm" className="gap-1.5" onClick={save} disabled={isPending || !connected}>
          <Save className="size-3.5" /> Save
        </Button>
      </div>
      {!connected && <p className="text-xs text-muted-foreground">Connect Twilio first.</p>}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
