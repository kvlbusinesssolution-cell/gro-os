"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { captureLead } from "../_lib/public-actions";

export function EnquiryForm({ listingId }: { listingId: string }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await captureLead(listingId, { type: "ENQUIRY_FORM", name, phone, email, message, companyWebsite });
      if (!result.ok) {
        toast.error(result.error ?? "Could not send your enquiry.");
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return <p className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">Thanks — your enquiry has been sent.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Send an enquiry</h3>
      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Textarea placeholder="What do you need?" value={message} onChange={(e) => setMessage(e.target.value)} />
      {/* Honeypot — hidden from real visitors via CSS, a bot filling this in trips it silently. */}
      <input
        type="text"
        value={companyWebsite}
        onChange={(e) => setCompanyWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 opacity-0"
      />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Send enquiry"}
      </Button>
    </form>
  );
}
