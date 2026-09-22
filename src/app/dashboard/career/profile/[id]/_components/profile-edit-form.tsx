"use client";

import { useState, useTransition } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateCareerProfile } from "../../../_lib/career-profile-actions";
import type { CareerProfileInput } from "@/lib/validations/career";

function toCsv(arr: string[]): string {
  return arr.join(", ");
}
function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export interface ProfileEditFormValue {
  id: string;
  name: string;
  currentRole: string | null;
  careerLevel: string | null;
  yearsOfExperience: number | null;
  location: string | null;
  industries: string[];
  portfolioUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  targetRoles: string[];
  targetCountries: string[];
  targetCities: string[];
  workMode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  employmentTypes: string[];
  experienceLevelMinYears: number | null;
  experienceLevelMaxYears: number | null;
  preferredTechnologies: string[];
  excludedTechnologies: string[];
  preferredCompanies: string[];
  excludedCompanies: string[];
  relocationPreference: string | null;
  noticePeriodDays: number | null;
}

export function ProfileEditForm({ profile }: { profile: ProfileEditFormValue }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(profile);

  function submit() {
    setError(null);
    setSaved(false);
    const input: CareerProfileInput = {
      name: form.name,
      currentRole: form.currentRole ?? "",
      careerLevel: form.careerLevel ?? "",
      yearsOfExperience: form.yearsOfExperience ?? undefined,
      location: form.location ?? "",
      industries: form.industries,
      portfolioUrl: form.portfolioUrl ?? "",
      githubUrl: form.githubUrl ?? "",
      linkedinUrl: form.linkedinUrl ?? "",
      websiteUrl: form.websiteUrl ?? "",
      targetRoles: form.targetRoles,
      targetCountries: form.targetCountries,
      targetCities: form.targetCities,
      workMode: (form.workMode as CareerProfileInput["workMode"]) ?? "",
      salaryMin: form.salaryMin ?? undefined,
      salaryMax: form.salaryMax ?? undefined,
      salaryCurrency: form.salaryCurrency ?? "",
      employmentTypes: form.employmentTypes as CareerProfileInput["employmentTypes"],
      experienceLevelMinYears: form.experienceLevelMinYears ?? undefined,
      experienceLevelMaxYears: form.experienceLevelMaxYears ?? undefined,
      preferredTechnologies: form.preferredTechnologies,
      excludedTechnologies: form.excludedTechnologies,
      preferredCompanies: form.preferredCompanies,
      excludedCompanies: form.excludedCompanies,
      relocationPreference: (form.relocationPreference as CareerProfileInput["relocationPreference"]) ?? "",
      noticePeriodDays: form.noticePeriodDays ?? undefined,
    };
    startTransition(async () => {
      const result = await updateCareerProfile(profile.id, input);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setSaved(true);
    });
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-5 p-5">
        <div>
          <p className="text-sm font-medium text-foreground">Profile &amp; identity</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Profile name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Current role">
              <Input value={form.currentRole ?? ""} onChange={(e) => setForm({ ...form, currentRole: e.target.value })} />
            </Field>
            <Field label="Career level">
              <Input value={form.careerLevel ?? ""} onChange={(e) => setForm({ ...form, careerLevel: e.target.value })} placeholder="e.g. Senior" />
            </Field>
            <Field label="Years of experience">
              <Input
                type="number"
                min={0}
                value={form.yearsOfExperience ?? ""}
                onChange={(e) => setForm({ ...form, yearsOfExperience: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
            <Field label="Location">
              <Input value={form.location ?? ""} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <Field label="Industries (comma-separated)">
              <Input value={toCsv(form.industries)} onChange={(e) => setForm({ ...form, industries: fromCsv(e.target.value) })} />
            </Field>
            <Field label="GitHub">
              <Input value={form.githubUrl ?? ""} onChange={(e) => setForm({ ...form, githubUrl: e.target.value })} />
            </Field>
            <Field label="LinkedIn">
              <Input value={form.linkedinUrl ?? ""} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
            </Field>
            <Field label="Portfolio">
              <Input value={form.portfolioUrl ?? ""} onChange={(e) => setForm({ ...form, portfolioUrl: e.target.value })} />
            </Field>
            <Field label="Website">
              <Input value={form.websiteUrl ?? ""} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">Preferences</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Target roles (comma-separated)">
              <Input value={toCsv(form.targetRoles)} onChange={(e) => setForm({ ...form, targetRoles: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Target countries (comma-separated)">
              <Input value={toCsv(form.targetCountries)} onChange={(e) => setForm({ ...form, targetCountries: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Target cities (comma-separated)">
              <Input value={toCsv(form.targetCities)} onChange={(e) => setForm({ ...form, targetCities: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Work mode">
              <Select value={form.workMode ?? ""} onChange={(e) => setForm({ ...form, workMode: e.target.value || null })}>
                <option value="">Any</option>
                <option value="REMOTE">Remote</option>
                <option value="HYBRID">Hybrid</option>
                <option value="ONSITE">Onsite</option>
              </Select>
            </Field>
            <Field label="Salary min">
              <Input type="number" min={0} value={form.salaryMin ?? ""} onChange={(e) => setForm({ ...form, salaryMin: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Salary max">
              <Input type="number" min={0} value={form.salaryMax ?? ""} onChange={(e) => setForm({ ...form, salaryMax: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Salary currency">
              <Input value={form.salaryCurrency ?? ""} onChange={(e) => setForm({ ...form, salaryCurrency: e.target.value })} placeholder="e.g. INR, USD" />
            </Field>
            <Field label="Relocation">
              <Select value={form.relocationPreference ?? ""} onChange={(e) => setForm({ ...form, relocationPreference: e.target.value || null })}>
                <option value="">Not set</option>
                <option value="WILLING">Willing</option>
                <option value="UNWILLING">Unwilling</option>
                <option value="CONDITIONAL">Conditional</option>
              </Select>
            </Field>
            <Field label="Notice period (days)">
              <Input type="number" min={0} value={form.noticePeriodDays ?? ""} onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Preferred technologies (comma-separated)">
              <Input value={toCsv(form.preferredTechnologies)} onChange={(e) => setForm({ ...form, preferredTechnologies: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Excluded technologies (comma-separated)">
              <Input value={toCsv(form.excludedTechnologies)} onChange={(e) => setForm({ ...form, excludedTechnologies: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Preferred companies (comma-separated)">
              <Input value={toCsv(form.preferredCompanies)} onChange={(e) => setForm({ ...form, preferredCompanies: fromCsv(e.target.value) })} />
            </Field>
            <Field label="Excluded companies (comma-separated)">
              <Input value={toCsv(form.excludedCompanies)} onChange={(e) => setForm({ ...form, excludedCompanies: fromCsv(e.target.value) })} />
            </Field>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && !error && <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</p>}
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
