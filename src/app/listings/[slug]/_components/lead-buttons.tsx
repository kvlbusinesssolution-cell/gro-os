"use client";

import { Phone, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { captureLead } from "../_lib/public-actions";

/** Fires a best-effort lead-capture write, then lets the real tel:/wa.me navigation happen — never blocks the click on the write. */
export function CallButton({ listingId, phone }: { listingId: string; phone: string }) {
  return (
    <Button asChild size="lg">
      <a href={`tel:${phone}`} onClick={() => void captureLead(listingId, { type: "CALL_CLICK", companyWebsite: "" })}>
        <Phone className="size-4" /> Call now
      </a>
    </Button>
  );
}

export function WhatsAppButton({ listingId, whatsappNumber }: { listingId: string; whatsappNumber: string }) {
  const digits = whatsappNumber.replace(/[^0-9]/g, "");

  return (
    <Button asChild variant="secondary" size="lg">
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void captureLead(listingId, { type: "WHATSAPP_CLICK", companyWebsite: "" })}
      >
        <MessageCircle className="size-4" /> WhatsApp
      </a>
    </Button>
  );
}
