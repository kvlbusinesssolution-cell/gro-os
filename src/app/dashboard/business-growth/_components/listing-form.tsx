"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { BusinessListingInput } from "@/lib/validations/listings";
import { createListing, updateListing } from "../_lib/listing-actions";

interface ListingFormProps {
  listingId?: string;
  initial?: Partial<BusinessListingInput>;
}

const EMPTY: BusinessListingInput = {
  businessName: "",
  tagline: "",
  description: "",
  category: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  phone: "",
  whatsappNumber: "",
  contactEmail: "",
  website: "",
  priceRange: "",
  videoUrl: "",
  metaTitle: "",
  metaDescription: "",
};

export function ListingForm({ listingId, initial }: ListingFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BusinessListingInput>({ ...EMPTY, ...initial });

  function set<K extends keyof BusinessListingInput>(key: K, value: BusinessListingInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = listingId ? await updateListing(listingId, form) : await createListing(form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save this listing.");
        return;
      }
      toast.success(listingId ? "Listing updated." : "Listing created — publish it when you're ready.");
      if (!listingId && "data" in result && result.data) {
        router.push(`/dashboard/business-growth/${result.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="Business name" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required />
        <Input placeholder="Category (e.g. Plumber, Restaurant)" value={form.category} onChange={(e) => set("category", e.target.value)} required />
      </div>
      <Input placeholder="Tagline (optional)" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
      <Textarea placeholder="Describe the business — what it does, what makes it worth choosing." value={form.description} onChange={(e) => set("description", e.target.value)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="Address line 1" value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} required />
        <Input placeholder="Address line 2 (optional)" value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
        <Input placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} required />
        <Input placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
        <Input placeholder="Postal code" value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
        <Input placeholder="Country" value={form.country} onChange={(e) => set("country", e.target.value)} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          placeholder="Latitude (optional, powers map + near-me search)"
          type="number"
          step="any"
          value={form.latitude ?? ""}
          onChange={(e) => set("latitude", e.target.value === "" ? undefined : Number(e.target.value))}
        />
        <Input
          placeholder="Longitude (optional)"
          type="number"
          step="any"
          value={form.longitude ?? ""}
          onChange={(e) => set("longitude", e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        <Input placeholder="WhatsApp number" value={form.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} />
        <Input placeholder="Contact email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
        <Input placeholder="Website" value={form.website} onChange={(e) => set("website", e.target.value)} />
        <Input placeholder="Price range (e.g. ₹₹)" value={form.priceRange} onChange={(e) => set("priceRange", e.target.value)} />
        <Input placeholder="Video URL (YouTube/Vimeo, optional)" value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="SEO title (optional, defaults to business name)" value={form.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} />
        <Input placeholder="SEO description (optional)" value={form.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : listingId ? "Save changes" : "Create listing"}
      </Button>
    </form>
  );
}
