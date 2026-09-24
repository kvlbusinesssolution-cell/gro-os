"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ScanSearch,
  Send,
  LineChart,
  RefreshCw,
  Bot,
  Workflow as WorkflowIcon,
  Receipt,
  MapPinned,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { fadeInUp, staggerContainer } from "@/animations";
import { cn } from "@/lib/utils";

type Accent = "emerald" | "blue" | "rose" | "amber";

interface Feature {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  description: string;
}

const ACCENT_STYLE = {
  badge: "bg-primary/10 text-primary border-primary/20",
  glow: "hover:shadow-glow-primary",
};

const ACCENT_STYLES: Record<Accent, { badge: string; glow: string }> = {
  emerald: ACCENT_STYLE,
  blue: ACCENT_STYLE,
  rose: ACCENT_STYLE,
  amber: ACCENT_STYLE,
};

const FEATURES: Feature[] = [
  {
    icon: ScanSearch,
    accent: "emerald",
    title: "AI Lead Qualification",
    description:
      "Every inbound and sourced lead is scored against your ICP in real time, so reps only spend time on prospects with genuine intent to buy.",
  },
  {
    icon: Send,
    accent: "blue",
    title: "Automated Multi-Channel Outreach",
    description:
      "Sequence email, LinkedIn, and SMS touches from a single campaign, with send times and messaging tuned per-contact by the outreach engine.",
  },
  {
    icon: LineChart,
    accent: "rose",
    title: "Growth Intelligence Dashboards",
    description:
      "Track pipeline velocity, channel ROI, and conversion drop-off in a single command center built for weekly growth reviews, not vanity metrics.",
  },
  {
    icon: RefreshCw,
    accent: "amber",
    title: "Pipeline & CRM Sync",
    description:
      "Two-way sync keeps HubSpot, Salesforce, and your CRM of record current automatically, eliminating duplicate entry and stale stage data.",
  },
  {
    icon: Bot,
    accent: "emerald",
    title: "AI Follow-Up Agents",
    description:
      "Purpose-built agents chase silent leads, answer common objections, and re-engage cold deals so no opportunity dies from neglect.",
  },
  {
    icon: WorkflowIcon,
    accent: "blue",
    title: "Workflow Automation Builder",
    description:
      "Compose triggers, conditions, and actions across acquisition and retention in a visual builder, no engineering ticket required.",
  },
  {
    icon: Receipt,
    accent: "rose",
    title: "From Lead to Paid Invoice, One System",
    description:
      "Proposals, contracts, project delivery, and GST-ready invoicing live in the same platform as your pipeline — revenue reporting traces back to invoices actually paid, not deals that merely closed.",
  },
  {
    icon: MapPinned,
    accent: "amber",
    title: "Local Directory & Career Agent, Built In",
    description:
      "A JustDial-style public business directory and an AI job-search agent run on the same infrastructure as your growth engine — two more ways this platform earns its keep beyond CRM.",
  },
];

function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <Container className="flex flex-col items-center gap-16">
        <SectionHeading
          eyebrow="Platform capabilities"
          title={
            <>
              Everything growth teams need,{" "}
              <span className="text-gradient-brand">unified in one OS</span>
            </>
          }
          description="KVL GrowthOS replaces a stack of disconnected point tools with a single system that qualifies, engages, and converts pipeline end to end."
        />

        <motion.div
          className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
        >
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            const accent = ACCENT_STYLES[feature.accent];

            return (
              <motion.div
                key={feature.title}
                variants={fadeInUp}
                whileHover={{ y: -6 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <Card
                  glass
                  className={cn(
                    "h-full transition-shadow duration-300 ease-[var(--ease-out-quad)]",
                    accent.glow,
                  )}
                >
                  <CardHeader>
                    <span
                      className={cn(
                        "inline-flex size-11 items-center justify-center rounded-xl border",
                        accent.badge,
                      )}
                    >
                      <Icon className="size-5" strokeWidth={2} />
                    </span>
                    <CardTitle className="mt-4">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </Container>
    </section>
  );
}

export default Features;
export { Features };
