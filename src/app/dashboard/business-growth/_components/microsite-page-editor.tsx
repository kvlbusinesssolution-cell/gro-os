"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { LandingPageBlock } from "@/lib/validations/marketing";
import { updateMicrositePage } from "../_lib/microsite-actions";

const PAGE_LABEL: Record<string, string> = { home: "Home", about: "About", services: "Services", contact: "Contact" };

export function MicrositePageEditor({ micrositeId, pageSlug, initialTitle, initialBlocks }: { micrositeId: string; pageSlug: string; initialTitle: string; initialBlocks: LandingPageBlock[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState<LandingPageBlock[]>(initialBlocks);

  function updateBlock(index: number, block: LandingPageBlock) {
    setBlocks((b) => b.map((existing, i) => (i === index ? block : existing)));
  }

  function save() {
    startTransition(async () => {
      const result = await updateMicrositePage(micrositeId, pageSlug, title, blocks);
      if (!result.ok) {
        toast.error(result.error ?? "Could not save this page.");
        return;
      }
      toast.success(`${PAGE_LABEL[pageSlug] ?? pageSlug} page saved.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{PAGE_LABEL[pageSlug] ?? pageSlug}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input placeholder="Page title" value={title} onChange={(e) => setTitle(e.target.value)} />
        {blocks.map((block, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-muted-foreground">{block.type}</span>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => setBlocks((b) => b.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
            {block.type === "paragraph" && (
              <Textarea value={block.content} onChange={(e) => updateBlock(index, { ...block, content: e.target.value })} rows={3} />
            )}
            {block.type === "bullets" && (
              <div className="flex flex-col gap-2">
                {block.items.map((item, itemIndex) => (
                  <Input
                    key={itemIndex}
                    value={item}
                    onChange={(e) => updateBlock(index, { ...block, items: block.items.map((it, i) => (i === itemIndex ? e.target.value : it)) })}
                  />
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => updateBlock(index, { ...block, items: [...block.items, ""] })}>
                  <Plus className="mr-1 size-3.5" /> Bullet
                </Button>
              </div>
            )}
            {block.type === "testimonial" && (
              <div className="flex flex-col gap-2">
                <Textarea value={block.quote} onChange={(e) => updateBlock(index, { ...block, quote: e.target.value })} rows={2} />
                <Input value={block.author} onChange={(e) => updateBlock(index, { ...block, author: e.target.value })} />
              </div>
            )}
            {block.type === "image" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Image URL" value={block.url} onChange={(e) => updateBlock(index, { ...block, url: e.target.value })} />
                <Input placeholder="Alt text" value={block.alt} onChange={(e) => updateBlock(index, { ...block, alt: e.target.value })} />
              </div>
            )}
          </div>
        ))}
        <Button type="button" size="sm" disabled={pending} onClick={save} className="w-fit">
          {pending ? "Saving…" : "Save page"}
        </Button>
      </CardContent>
    </Card>
  );
}
