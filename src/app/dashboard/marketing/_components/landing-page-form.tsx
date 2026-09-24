"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { MarketingLandingPageInput, LandingPageBlock, LandingPageFormField } from "@/lib/validations/marketing";
import { createLandingPage, updateLandingPage } from "../_lib/landing-page-actions";

interface LandingPageFormProps {
  landingPageId?: string;
  initial?: Partial<MarketingLandingPageInput>;
}

const EMPTY: MarketingLandingPageInput = {
  title: "",
  headline: "",
  subheadline: "",
  heroImageUrl: "",
  bodyBlocks: [],
  formFields: [
    { key: "name", label: "Full name", type: "text", required: true, role: "name" },
    { key: "email", label: "Work email", type: "email", required: true, role: "email" },
  ],
  metaTitle: "",
  metaDescription: "",
};

function moveItem<T>(arr: T[], index: number, direction: -1 | 1): T[] {
  const next = [...arr];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function defaultBlock(type: LandingPageBlock["type"]): LandingPageBlock {
  switch (type) {
    case "paragraph":
      return { type: "paragraph", content: "" };
    case "image":
      return { type: "image", url: "", alt: "" };
    case "testimonial":
      return { type: "testimonial", quote: "", author: "" };
    case "bullets":
      return { type: "bullets", items: [""] };
  }
}

export function LandingPageForm({ landingPageId, initial }: LandingPageFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<MarketingLandingPageInput>({ ...EMPTY, ...initial });

  function set<K extends keyof MarketingLandingPageInput>(key: K, value: MarketingLandingPageInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateBlock(index: number, block: LandingPageBlock) {
    set("bodyBlocks", form.bodyBlocks.map((b, i) => (i === index ? block : b)));
  }

  function updateField(index: number, field: LandingPageFormField) {
    set("formFields", form.formFields.map((f, i) => (i === index ? field : f)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = landingPageId ? await updateLandingPage(landingPageId, form) : await createLandingPage(form);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save this page.");
        return;
      }
      toast.success(landingPageId ? "Page updated." : "Page created — publish it when you're ready.");
      if (!landingPageId && "data" in result && result.data) {
        router.push(`/dashboard/marketing/landing-pages/${result.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="Internal page title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
        <Input placeholder="Hero image URL (optional)" value={form.heroImageUrl} onChange={(e) => set("heroImageUrl", e.target.value)} />
        <Input placeholder="Headline" value={form.headline} onChange={(e) => set("headline", e.target.value)} required className="sm:col-span-2" />
        <Textarea placeholder="Subheadline (optional)" value={form.subheadline} onChange={(e) => set("subheadline", e.target.value)} rows={2} className="sm:col-span-2" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Page content blocks</CardTitle>
          <div className="flex flex-wrap gap-1">
            {(["paragraph", "image", "testimonial", "bullets"] as const).map((type) => (
              <Button key={type} type="button" size="sm" variant="outline" onClick={() => set("bodyBlocks", [...form.bodyBlocks, defaultBlock(type)])}>
                <Plus className="mr-1 size-3.5" /> {type}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {form.bodyBlocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet — add one above.</p>}
          {form.bodyBlocks.map((block, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-muted-foreground">{block.type}</span>
                <div className="flex gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => set("bodyBlocks", moveItem(form.bodyBlocks, index, -1))}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => set("bodyBlocks", moveItem(form.bodyBlocks, index, 1))}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => set("bodyBlocks", form.bodyBlocks.filter((_, i) => i !== index))}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              {block.type === "paragraph" && (
                <Textarea placeholder="Paragraph text" value={block.content} onChange={(e) => updateBlock(index, { ...block, content: e.target.value })} rows={3} />
              )}
              {block.type === "image" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Image URL" value={block.url} onChange={(e) => updateBlock(index, { ...block, url: e.target.value })} />
                  <Input placeholder="Alt text" value={block.alt} onChange={(e) => updateBlock(index, { ...block, alt: e.target.value })} />
                </div>
              )}
              {block.type === "testimonial" && (
                <div className="flex flex-col gap-2">
                  <Textarea placeholder="Quote" value={block.quote} onChange={(e) => updateBlock(index, { ...block, quote: e.target.value })} rows={2} />
                  <Input placeholder="Author" value={block.author} onChange={(e) => updateBlock(index, { ...block, author: e.target.value })} />
                </div>
              )}
              {block.type === "bullets" && (
                <div className="flex flex-col gap-2">
                  {block.items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex gap-2">
                      <Input
                        placeholder={`Bullet ${itemIndex + 1}`}
                        value={item}
                        onChange={(e) => updateBlock(index, { ...block, items: block.items.map((it, i) => (i === itemIndex ? e.target.value : it)) })}
                      />
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => updateBlock(index, { ...block, items: block.items.filter((_, i) => i !== itemIndex) })}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={() => updateBlock(index, { ...block, items: [...block.items, ""] })}>
                    <Plus className="mr-1 size-3.5" /> Bullet
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Lead-capture form fields</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set("formFields", [...form.formFields, { key: `field_${form.formFields.length}`, label: "", type: "text", required: false, role: "other" }])}
          >
            <Plus className="mr-1 size-3.5" /> Field
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Exactly one required field needs role &quot;name&quot; and one needs role &quot;email&quot; — a submission becomes a real CRM contact.
          </p>
          {form.formFields.map((field, index) => (
            <div key={index} className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
              <Input placeholder="Key" value={field.key} onChange={(e) => updateField(index, { ...field, key: e.target.value })} className="sm:col-span-1" />
              <Input placeholder="Label" value={field.label} onChange={(e) => updateField(index, { ...field, label: e.target.value })} className="sm:col-span-2" />
              <Select value={field.type} onChange={(e) => updateField(index, { ...field, type: e.target.value as LandingPageFormField["type"] })} className="sm:col-span-1">
                <option value="text">Text</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="textarea">Textarea</option>
              </Select>
              <Select value={field.role} onChange={(e) => updateField(index, { ...field, role: e.target.value as LandingPageFormField["role"] })} className="sm:col-span-1">
                <option value="other">Other</option>
                <option value="name">Name</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </Select>
              <div className="flex items-center justify-between gap-2 sm:col-span-1">
                <label htmlFor={`field-required-${index}`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox id={`field-required-${index}`} checked={field.required} onChange={(e) => updateField(index, { ...field, required: e.target.checked })} /> Required
                </label>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => set("formFields", form.formFields.filter((_, i) => i !== index))}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input placeholder="Meta title (SEO, optional)" value={form.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} />
        <Input placeholder="Meta description (SEO, optional)" value={form.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : landingPageId ? "Save changes" : "Create page"}
        </Button>
      </div>
    </form>
  );
}
