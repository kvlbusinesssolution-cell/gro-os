"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { BusinessCatalogItemInput } from "@/lib/validations/listings";
import { createCatalogItem } from "../_lib/catalog-actions";

const EMPTY: BusinessCatalogItemInput = { name: "", description: "", price: undefined, priceUnit: "" };

export function CatalogForm({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<BusinessCatalogItemInput>(EMPTY);

  function set<K extends keyof BusinessCatalogItemInput>(key: K, value: BusinessCatalogItemInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createCatalogItem(listingId, form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not add this item.");
        return;
      }
      toast.success("Item added as a draft — publish it to make it live.");
      setForm(EMPTY);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input placeholder="Item / service name" value={form.name} onChange={(e) => set("name", e.target.value)} required className="sm:col-span-2" />
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Price"
            type="number"
            step="any"
            value={form.price ?? ""}
            onChange={(e) => set("price", e.target.value === "" ? undefined : Number(e.target.value))}
          />
          <Input placeholder="Unit (e.g. /hr)" value={form.priceUnit} onChange={(e) => set("priceUnit", e.target.value)} />
        </div>
      </div>
      <Textarea placeholder="Describe this product or service (optional)" value={form.description} onChange={(e) => set("description", e.target.value)} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Add item"}
      </Button>
    </form>
  );
}
