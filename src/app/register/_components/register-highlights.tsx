"use client";

import { motion } from "framer-motion";
import { Briefcase, ScanSearch, LineChart, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeInUp, staggerContainer } from "@/animations";

interface Highlight {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}

const HIGHLIGHTS: Highlight[] = [
  {
    icon: Briefcase,
    title: "AI Career Agent",
    description:
      "Discovers real job openings, matches them against your verified profile, and tailors every application — included with your workspace.",
    badge: "New",
  },
  {
    icon: ScanSearch,
    title: "AI Lead Qualification & Outreach",
    description: "Every prospect scored against your ICP, with multi-channel sequences run automatically.",
  },
  {
    icon: LineChart,
    title: "Revenue Command Center",
    description: "One dashboard for pipeline velocity, channel ROI, and where deals are stalling.",
  },
];

/**
 * Only rendered for the default (non-white-labeled) GrowthOS signup — a
 * reseller's rebranded signup page should never surface KVL's own product
 * positioning. See src/app/register/page.tsx's `showHighlights` check.
 */
export function RegisterHighlights() {
  return (
    <motion.div
      className="flex w-full flex-col gap-5"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={fadeInUp}>
        <h2 className="text-2xl font-semibold text-foreground">
          Your AI workforce is waiting
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          One workspace, one login — a team of AI agents working your pipeline and your career, around the clock.
        </p>
      </motion.div>

      {HIGHLIGHTS.map((highlight) => {
        const Icon = highlight.icon;

        return (
          <motion.div key={highlight.title} variants={fadeInUp}>
            <Card glass className="p-4">
              <CardHeader className="flex-row items-start gap-3 p-0">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="size-4.5" strokeWidth={2} />
                </span>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{highlight.title}</CardTitle>
                    {highlight.badge && <Badge variant="accent">{highlight.badge}</Badge>}
                  </div>
                  <CardContent className="p-0">
                    <CardDescription className="text-sm leading-relaxed">
                      {highlight.description}
                    </CardDescription>
                  </CardContent>
                </div>
              </CardHeader>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
