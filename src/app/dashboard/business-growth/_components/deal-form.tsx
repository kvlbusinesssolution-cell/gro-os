"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { BusinessDealInput } from "@/lib/validations/listings";
import { createDeal } from "../_lib/deal-actions";

const EMPTY: BusinessDealInput = { title: "", description: "", discountLabel: "", termsAndConditions: "" };

export function DealForm({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BusinessDealInput>(EMPTY);

  function set<K extends keyof BusinessDealInput>(key: K, value: BusinessDealInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createDeal(listingId, form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not create this deal.");
        return;
      }
      toast.success("Deal created as a draft — publish it to make it live.");
      setForm(EMPTY);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Deal title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
        <Input placeholder="Discount label (e.g. 20% OFF)" value={form.discountLabel} onChange={(e) => set("discountLabel", e.target.value)} />
      </div>
      <Textarea placeholder="Describe the deal" value={form.description} onChange={(e) => set("description", e.target.value)} />
      <Textarea placeholder="Terms & conditions (optional)" value={form.termsAndConditions} onChange={(e) => set("termsAndConditions", e.target.value)} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Create deal"}
      </Button>
    </form>
  );
}
