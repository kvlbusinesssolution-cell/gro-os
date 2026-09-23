"use client";

import { motion } from "framer-motion";
import { Webhook } from "lucide-react";

import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { Card } from "@/components/ui/card";
import { fadeInUp } from "@/animations";

const VERIFY_SNIPPET = `import crypto from "crypto";

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}`;

const EVENT_CATALOG = ["contact.created", "company.created", "deal.won", "deal.lost", "application.status_changed"];

/**
 * Real outbound webhook signing exists (src/lib/workflows/webhook-signature.ts
 * — HMAC-SHA256, timing-safe verify) — wired into workflow "outgoing
 * webhook" steps AND, as of Phase 33, into a real platform-wide event bus
 * (src/lib/webhooks/event-bus.ts, WebhookEventType in schema.prisma) with a
 * small, honest, growing catalog of typed events — subscribe from
 * Settings -> API Manager. Not every model/mutation emits an event yet; the
 * catalog below is exactly what's real today, never a wishlist.
 */
function WebhooksDocs() {
  return (
    <section className="relative py-24 sm:py-32">
      <Container className="flex flex-col items-center gap-10">
        <SectionHeading
          eyebrow="Webhooks"
          title="Real HMAC-signed webhook delivery"
          description="Every webhook we send is signed, with automatic retry on failure. Configure a webhook per Automation Builder workflow, or subscribe to a real, typed platform event from Settings -> API Manager."
        />
        <div className="flex flex-wrap justify-center gap-2">
          {EVENT_CATALOG.map((event) => (
            <code key={event} className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-foreground">
              {event}
            </code>
          ))}
        </div>
        <motion.div variants={fadeInUp} initial="hidden" whileInView="visible" viewport={{ once: true }} className="w-full max-w-2xl">
          <Card glass className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Webhook className="size-4 text-primary" strokeWidth={2.5} />
              Verify a webhook signature (real HMAC-SHA256)
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs text-foreground">
              <code>{VERIFY_SNIPPET}</code>
            </pre>
            <p className="text-xs text-muted-foreground">
              Every outbound webhook request carries a signature header computed the same way — configure webhook steps
              from the Automation Builder in your dashboard.
            </p>
          </Card>
        </motion.div>
      </Container>
    </section>
  );
}

export default WebhooksDocs;
export { WebhooksDocs };
