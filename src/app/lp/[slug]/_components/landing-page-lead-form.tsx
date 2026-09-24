"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LandingPageFormField } from "@/lib/validations/marketing";
import { submitLandingPageLead } from "../../_lib/public-actions";

export function LandingPageLeadForm({ landingPageId, formFields }: { landingPageId: string; formFields: LandingPageFormField[] }) {
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitLandingPageLead(landingPageId, { fields: values, companyWebsite });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong — please try again.");
        return;
      }
      setSubmitted(true);
      if (result.downloadUrl) setDownloadUrl(result.downloadUrl);
    });
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-lg font-medium text-foreground">Thank you — we&apos;ll be in touch shortly.</p>
        {downloadUrl && (
          <a href={downloadUrl} className="text-primary hover:underline">
            Download your free resource
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {formFields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label className="text-sm font-medium text-foreground">
            {field.label}
            {field.required && " *"}
          </label>
          {field.type === "textarea" ? (
            <Textarea
              required={field.required}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              rows={3}
            />
          ) : (
            <Input
              type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
              required={field.required}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
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
      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
