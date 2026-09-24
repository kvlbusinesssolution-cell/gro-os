"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { requestQuotes } from "../_lib/public-actions";

/** JustDial's flagship "Get Quotes" flow — one message fanned out to every matching business at once. */
export function GetQuotesForm({ categories, cities }: { categories: string[]; cities: string[] }) {
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState(categories[0] ?? "");
  const [city, setCity] = useState(cities[0] ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot
  const [matchedCount, setMatchedCount] = useState<number | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestQuotes({ category, city, name, phone, email, message, companyWebsite });
      if (!result.ok) {
        toast.error(result.error ?? "Could not send your quote request.");
        return;
      }
      setMatchedCount(result.matchedCount ?? 0);
    });
  }

  if (matchedCount !== null) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
        Sent to {matchedCount} matching business{matchedCount === 1 ? "" : "es"} — they'll reach out to you directly.
      </p>
    );
  }

  if (categories.length === 0 || cities.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Get quotes from multiple businesses</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={city} onChange={(e) => setCity(e.target.value)}>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
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
        {pending ? "Sending…" : "Get quotes"}
      </Button>
    </form>
  );
}
