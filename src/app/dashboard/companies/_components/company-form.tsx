"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createCompany } from "../actions";

const STATUS_OPTIONS = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "LEAD", label: "Lead" },
  { value: "CLIENT", label: "Client" },
  { value: "CHURNED", label: "Churned" },
] as const;

export interface CompanyFormReferralPartnerOption {
  id: string;
  name: string;
}

export interface CompanyFormProps {
  /** ACTIVE-only referral partners for this org — see companies/page.tsx's fetch. */
  referralPartners?: CompanyFormReferralPartnerOption[];
}

export function CompanyForm({ referralPartners = [] }: CompanyFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("PROSPECT");
  const [referralPartnerId, setReferralPartnerId] = useState("");

  function reset() {
    setName("");
    setIndustry("");
    setWebsite("");
    setEmail("");
    setPhone("");
    setEmployeeCount("");
    setStatus("PROSPECT");
    setReferralPartnerId("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCompany({
        name,
        industry,
        website,
        email,
        phone,
        employeeCount: employeeCount ? Number(employeeCount) : undefined,
        status,
        referralPartnerId: referralPartnerId || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add company
      </Button>
    );
  }

  return (
    <Card glass className="w-full">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Add company</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Company name" htmlFor="company-name" required>
            <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label="Industry" htmlFor="company-industry">
            <Input id="company-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </FormField>
          <FormField label="Website" htmlFor="company-website">
            <Input id="company-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </FormField>
          <FormField label="Email" htmlFor="company-email">
            <Input id="company-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Phone" htmlFor="company-phone">
            <Input id="company-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          <FormField label="Employees" htmlFor="company-employees">
            <Input
              id="company-employees"
              type="number"
              min={0}
              value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)}
            />
          </FormField>
          <FormField label="Status" htmlFor="company-status" required>
            <Select
              id="company-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Referral partner"
            htmlFor="company-referral-partner"
            hint="Who referred this company in, if anyone — sets its source to Referral."
          >
            <Select
              id="company-referral-partner"
              value={referralPartnerId}
              onChange={(e) => setReferralPartnerId(e.target.value)}
            >
              <option value="">None</option>
              {referralPartners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </Select>
          </FormField>

          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}

          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save company"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
