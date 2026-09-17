"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { fadeInUp } from "@/animations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { trackMarketingEvent } from "@/lib/client/track-marketing-event";

const FEATURES = [
  "Full 5-agent AI workforce (CEO, Sales, Marketing, Proposal, Outreach)",
  "Unlimited leads — no monthly cap",
  "Outreach AI agent (email + LinkedIn sequencing)",
  "Two-way CRM sync (HubSpot, Salesforce, Pipedrive)",
  "Automated proposal & quote generation",
  "Multi-sender rotation & inbox warm-up",
  "Role-based access & tenant-isolated permissions",
  "Priority support",
];

function Pricing() {
  return (
    <section className="relative py-24 sm:py-32">
      <Container className="flex flex-col items-center gap-14">
        <SectionHeading
          eyebrow="Pricing"
          title="100% Free — Full Access"
          description="KVL Business Solutions runs no subscriptions and no paid tiers. Every AI agent and every feature, free — for good."
        />

        <motion.div
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="w-full max-w-md"
        >
          <Card
            glass
            className="relative flex flex-col gap-6 border-primary/40 p-8 shadow-elevated shadow-glow-primary"
          >
            <Badge
              variant="accent"
              className="absolute -top-3 left-1/2 -translate-x-1/2"
            >
              No credit card required
            </Badge>

            <div className="flex flex-col gap-2 text-center">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                Full Access
              </h3>
              <p className="text-sm text-muted-foreground">
                Everything KVL Business Solutions offers, free of charge.
              </p>
            </div>

            <div className="flex items-end justify-center gap-1.5">
              <span className="text-4xl font-semibold tracking-tight text-foreground">
                Free
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                forever
              </span>
            </div>

            <ul className="flex flex-1 flex-col gap-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-sm text-muted-foreground"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    strokeWidth={2.5}
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Button variant="default" size="lg" className="w-full" asChild>
              <Link
                href="/register"
                onClick={() => trackMarketingEvent("CTA_CLICK", "/product", "pricing_free_full_access")}
              >
                Get Started Free
              </Link>
            </Button>
          </Card>
        </motion.div>
      </Container>
    </section>
  );
}

export default Pricing;
export { Pricing };
