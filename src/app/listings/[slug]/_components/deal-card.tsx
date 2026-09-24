"use client";

import { useTransition } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { captureLead } from "../_lib/public-actions";

interface Deal {
  id: string;
  title: string;
  description: string | null;
  discountLabel: string | null;
}

export function DealCard({ listingId, deal }: { listingId: string; deal: Deal }) {
  const [pending, startTransition] = useTransition();

  function claim() {
    startTransition(async () => {
      const result = await captureLead(listingId, { type: "ENQUIRY_FORM", dealId: deal.id, message: `Interested in: ${deal.title}`, companyWebsite: "" });
      if (!result.ok) {
        toast.error(result.error ?? "Could not claim this deal.");
        return;
      }
      toast.success("Noted — the business will follow up with you.");
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{deal.title}</span>
          {deal.discountLabel && <Badge variant="accent">{deal.discountLabel}</Badge>}
        </div>
        {deal.description && <p className="text-sm text-muted-foreground">{deal.description}</p>}
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={claim} className="self-start">
          {pending ? "Claiming…" : "Claim this deal"}
        </Button>
      </CardContent>
    </Card>
  );
}
