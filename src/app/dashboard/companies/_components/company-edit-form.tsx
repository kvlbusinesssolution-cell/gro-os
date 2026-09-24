"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Briefcase, Globe2, MapPin, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { ImageUploadField } from "@/components/upload/image-upload-field";
import { updateCompany, deleteCompany } from "../actions";
import { INDUSTRIES } from "@/lib/industries";
import type { CompanyStatusInput } from "@/lib/validations/company-directory";

const STATUS_OPTIONS = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "LEAD", label: "Lead" },
  { value: "CLIENT", label: "Client" },
  { value: "CHURNED", label: "Churned" },
] as const;

export interface CompanyEditFormFields {
  name: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  employeeCount: string;
  notes: string;
  status: CompanyStatusInput;
  logo: string;
  description: string;
  headquartersCountry: string;
  headquartersState: string;
  headquartersCity: string;
  estimatedRevenue: string;
  foundedYear: string;
  technologies: string;
  products: string;
  servicesOffered: string;
  targetCustomers: string;
  linkedinUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  instagramUrl: string;
  googleMapsUrl: string;
  contactFormUrl: string;
  businessType: string;
  remoteHybrid: string;
  publicPrivate: string;
  growthRate: string;
  fundingStage: string;
  fundingAmount: string;
  fundingDate: string;
  language: string;
  referralPartnerId: string;
}

export interface CompanyEditFormReferralPartnerOption {
  id: string;
  name: string;
}

export interface CompanyEditFormProps {
  companyId: string;
  organizationId: string;
  canDelete: boolean;
  initial: CompanyEditFormFields;
  /** ACTIVE-only referral partners for this org — see companies/[id]/page.tsx's fetch. */
  referralPartners?: CompanyEditFormReferralPartnerOption[];
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function CompanyEditForm({
  companyId,
  organizationId,
  canDelete,
  initial,
  referralPartners = [],
}: CompanyEditFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, startDeleteTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [fields, setFields] = useState(initial);

  // Dirty-state tracking — this form has ~35 fields across 4 sections; a
  // silent "your edits vanished" surprise (accidental back-nav, a
  // RealtimeRefresher-triggered router.refresh() landing mid-edit) is worse
  // here than most forms in this app. Deliberately a plain deep-equality
  // check against `initial` rather than a separate `touched` flag, so it
  // stays accurate even if a field is edited and then edited back to its
  // original value.
  const isDirty = useMemo(() => JSON.stringify(fields) !== JSON.stringify(initial), [fields, initial]);

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function set<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateCompany(companyId, {
        ...fields,
        employeeCount: fields.employeeCount ? Number(fields.employeeCount) : undefined,
        estimatedRevenue: fields.estimatedRevenue ? Number(fields.estimatedRevenue) : undefined,
        foundedYear: fields.foundedYear ? Number(fields.foundedYear) : undefined,
        growthRate: fields.growthRate ? Number(fields.growthRate) : undefined,
        fundingAmount: fields.fundingAmount ? Number(fields.fundingAmount) : undefined,
        fundingDate: fields.fundingDate || undefined,
        technologies: splitTags(fields.technologies),
        products: splitTags(fields.products),
        servicesOffered: splitTags(fields.servicesOffered),
      });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${fields.name}? This cannot be undone.`)) return;
    startDeleteTransition(async () => {
      const result = await deleteCompany(companyId);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.push("/dashboard/companies");
    });
  }

  return (
    <Card glass className="relative overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Company details</CardTitle>
        {canDelete && (
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting}>
            <Trash2 className="size-4" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Company name" htmlFor="edit-name" required>
              <Input id="edit-name" value={fields.name} onChange={(e) => set("name", e.target.value)} required />
            </FormField>
            <FormField label="Industry" htmlFor="edit-industry">
              <Select id="edit-industry" value={fields.industry} onChange={(e) => set("industry", e.target.value)}>
                <option value="">Not set</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Logo" htmlFor="edit-logo">
              <ImageUploadField
                id="edit-logo"
                uploadUrl={`/api/organizations/${organizationId}/assets`}
                extraFields={{ kind: "image", previousUrl: fields.logo }}
                value={fields.logo}
                onChange={(url) => set("logo", url)}
              />
            </FormField>
            <FormField label="Founded year" htmlFor="edit-founded">
              <Input
                id="edit-founded"
                type="number"
                value={fields.foundedYear}
                onChange={(e) => set("foundedYear", e.target.value)}
              />
            </FormField>
            <FormField label="Description" htmlFor="edit-description" className="sm:col-span-2">
              <textarea
                id="edit-description"
                value={fields.description}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-input bg-transparent px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </FormField>
            <FormField label="Status" htmlFor="edit-status" required>
              <Select
                id="edit-status"
                value={fields.status}
                onChange={(e) => set("status", e.target.value as CompanyStatusInput)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Employees" htmlFor="edit-employees">
              <Input
                id="edit-employees"
                type="number"
                min={0}
                value={fields.employeeCount}
                onChange={(e) => set("employeeCount", e.target.value)}
              />
            </FormField>
            <FormField
              label="Referral partner"
              htmlFor="edit-referral-partner"
              hint="Who referred this company in, if anyone."
            >
              <Select
                id="edit-referral-partner"
                value={fields.referralPartnerId}
                onChange={(e) => set("referralPartnerId", e.target.value)}
              >
                <option value="">None</option>
                {referralPartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <Accordion type="multiple" defaultValue={["location", "business", "contact"]} className="flex flex-col gap-3">
            <AccordionItem value="location" className="rounded-xl border border-border px-4">
              <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                <span className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" /> Location
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-3">
                  <FormField label="Country" htmlFor="edit-hq-country">
                    <Input
                      id="edit-hq-country"
                      value={fields.headquartersCountry}
                      onChange={(e) => set("headquartersCountry", e.target.value)}
                    />
                  </FormField>
                  <FormField label="State / Region" htmlFor="edit-hq-state">
                    <Input
                      id="edit-hq-state"
                      value={fields.headquartersState}
                      onChange={(e) => set("headquartersState", e.target.value)}
                    />
                  </FormField>
                  <FormField label="City" htmlFor="edit-hq-city">
                    <Input id="edit-hq-city" value={fields.headquartersCity} onChange={(e) => set("headquartersCity", e.target.value)} />
                  </FormField>
                  <FormField label="Address" htmlFor="edit-address" className="sm:col-span-3">
                    <Input id="edit-address" value={fields.address} onChange={(e) => set("address", e.target.value)} />
                  </FormField>
                  <FormField label="Google Maps URL" htmlFor="edit-maps-url" className="sm:col-span-2">
                    <Input id="edit-maps-url" value={fields.googleMapsUrl} onChange={(e) => set("googleMapsUrl", e.target.value)} />
                  </FormField>
                  <p className="text-xs text-muted-foreground sm:col-span-3">
                    Saving with a city/state/country set will best-effort geocode a map pin via OpenStreetMap if one isn&apos;t
                    already set.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="business" className="rounded-xl border border-border px-4">
              <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                <span className="flex items-center gap-2">
                  <Briefcase className="size-4 text-muted-foreground" /> Business details
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-3">
                  <FormField label="Business type (B2B/B2C…)" htmlFor="edit-business-type">
                    <Input id="edit-business-type" value={fields.businessType} onChange={(e) => set("businessType", e.target.value)} />
                  </FormField>
                  <FormField label="Remote / Hybrid / Onsite" htmlFor="edit-remote">
                    <Input id="edit-remote" value={fields.remoteHybrid} onChange={(e) => set("remoteHybrid", e.target.value)} />
                  </FormField>
                  <FormField label="Public / Private" htmlFor="edit-public">
                    <Input id="edit-public" value={fields.publicPrivate} onChange={(e) => set("publicPrivate", e.target.value)} />
                  </FormField>
                  <FormField label="Estimated revenue (annual)" htmlFor="edit-revenue">
                    <Input
                      id="edit-revenue"
                      type="number"
                      min={0}
                      value={fields.estimatedRevenue}
                      onChange={(e) => set("estimatedRevenue", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Growth rate (% YoY)" htmlFor="edit-growth">
                    <Input id="edit-growth" type="number" value={fields.growthRate} onChange={(e) => set("growthRate", e.target.value)} />
                  </FormField>
                  <FormField label="Language" htmlFor="edit-language">
                    <Input id="edit-language" value={fields.language} onChange={(e) => set("language", e.target.value)} />
                  </FormField>
                  <FormField label="Funding stage" htmlFor="edit-funding-stage">
                    <Input
                      id="edit-funding-stage"
                      value={fields.fundingStage}
                      onChange={(e) => set("fundingStage", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Funding amount" htmlFor="edit-funding-amount">
                    <Input
                      id="edit-funding-amount"
                      type="number"
                      min={0}
                      value={fields.fundingAmount}
                      onChange={(e) => set("fundingAmount", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Funding date" htmlFor="edit-funding-date">
                    <Input
                      id="edit-funding-date"
                      type="date"
                      value={fields.fundingDate}
                      onChange={(e) => set("fundingDate", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Target customers" htmlFor="edit-target-customers" className="sm:col-span-3">
                    <Input
                      id="edit-target-customers"
                      value={fields.targetCustomers}
                      onChange={(e) => set("targetCustomers", e.target.value)}
                    />
                  </FormField>
                  <FormField label="Technologies (comma-separated)" htmlFor="edit-tech" className="sm:col-span-3">
                    <Input id="edit-tech" value={fields.technologies} onChange={(e) => set("technologies", e.target.value)} />
                  </FormField>
                  <FormField label="Products (comma-separated)" htmlFor="edit-products" className="sm:col-span-3">
                    <Input id="edit-products" value={fields.products} onChange={(e) => set("products", e.target.value)} />
                  </FormField>
                  <FormField label="Services offered (comma-separated)" htmlFor="edit-services" className="sm:col-span-3">
                    <Input
                      id="edit-services"
                      value={fields.servicesOffered}
                      onChange={(e) => set("servicesOffered", e.target.value)}
                    />
                  </FormField>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="contact" className="rounded-xl border border-border px-4">
              <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline">
                <span className="flex items-center gap-2">
                  <Globe2 className="size-4 text-muted-foreground" /> Contact intelligence
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-2">
                  <FormField label="Website" htmlFor="edit-website">
                    <Input id="edit-website" value={fields.website} onChange={(e) => set("website", e.target.value)} />
                  </FormField>
                  <FormField label="Email" htmlFor="edit-email">
                    <Input id="edit-email" type="email" value={fields.email} onChange={(e) => set("email", e.target.value)} />
                  </FormField>
                  <FormField label="Phone" htmlFor="edit-phone">
                    <Input id="edit-phone" value={fields.phone} onChange={(e) => set("phone", e.target.value)} />
                  </FormField>
                  <FormField label="Contact form URL" htmlFor="edit-contact-form">
                    <Input
                      id="edit-contact-form"
                      value={fields.contactFormUrl}
                      onChange={(e) => set("contactFormUrl", e.target.value)}
                    />
                  </FormField>
                  <FormField label="LinkedIn" htmlFor="edit-linkedin">
                    <Input id="edit-linkedin" value={fields.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} />
                  </FormField>
                  <FormField label="Facebook" htmlFor="edit-facebook">
                    <Input id="edit-facebook" value={fields.facebookUrl} onChange={(e) => set("facebookUrl", e.target.value)} />
                  </FormField>
                  <FormField label="Twitter / X" htmlFor="edit-twitter">
                    <Input id="edit-twitter" value={fields.twitterUrl} onChange={(e) => set("twitterUrl", e.target.value)} />
                  </FormField>
                  <FormField label="Instagram" htmlFor="edit-instagram">
                    <Input id="edit-instagram" value={fields.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} />
                  </FormField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <FormField label="Notes" htmlFor="edit-notes">
            <textarea
              id="edit-notes"
              value={fields.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-input bg-transparent px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </FormField>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Sticky save bar — this form runs ~35 fields deep; without this,
              "Save changes" can sit a full scroll-length below whatever the
              editor is actually looking at. Sticks to the bottom of the
              viewport (not the card) once scrolled past, glass-panel'd to
              read as a distinct floating control. */}
          <div className="sticky bottom-4 z-10 -mx-1 flex items-center gap-3 rounded-xl border border-border glass-panel-strong px-4 py-3 shadow-elevated">
            <Button type="submit" disabled={pending || !isDirty}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            {isDirty && !pending && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="size-3.5" /> Unsaved changes
              </span>
            )}
            {success && !isDirty && <span className="text-xs text-primary">Saved.</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
