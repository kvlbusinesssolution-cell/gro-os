"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Briefcase, ScanSearch, FileEdit, CalendarCheck, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Container } from "@/components/ui/container";
import { fadeInUp, staggerContainer } from "@/animations";

interface CareerCapability {
  icon: LucideIcon;
  title: string;
  description: string;
}

const CAPABILITIES: CareerCapability[] = [
  {
    icon: ScanSearch,
    title: "Job Discovery & Matching",
    description:
      "Your AI Career Agent scans real job postings and scores each one against your verified skills, experience, and preferences — no guesswork, no fabricated matches.",
  },
  {
    icon: FileEdit,
    title: "Resume & Cover Letter Tailoring",
    description:
      "Every application gets a resume and cover letter tailored to that specific role, built only from your real, verified background — never invented experience.",
  },
  {
    icon: CalendarCheck,
    title: "Recruiter Replies & Interview Scheduling",
    description:
      "Recruiter emails are read, classified, and routed automatically, with interview requests surfaced for your approval — you stay in control of every yes.",
  },
];

function CareerAgentSection() {
  return (
    <section id="career-agent" className="relative py-24 sm:py-32">
      <Container className="flex flex-col items-center gap-16">
        <SectionHeading
          eyebrow="AI Career Agent"
          title={
            <>
              Your job search, run by{" "}
              <span className="text-gradient-brand">an AI agent that never sleeps</span>
            </>
          }
          description="Upload your resume once. Your AI Career Agent finds relevant openings, checks real eligibility, tailors every application, and keeps you posted the moment a recruiter replies."
        />

        <motion.div
          className="grid w-full grid-cols-1 gap-6 sm:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
        >
          {CAPABILITIES.map((capability) => {
            const Icon = capability.icon;

            return (
              <motion.div
                key={capability.title}
                variants={fadeInUp}
                whileHover={{ y: -6 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <Card
                  glass
                  className="h-full transition-shadow duration-300 ease-[var(--ease-out-quad)] hover:shadow-glow-primary"
                >
                  <CardHeader>
                    <span className="inline-flex size-11 items-center justify-center rounded-xl border bg-primary/10 text-primary border-primary/20">
                      <Icon className="size-5" strokeWidth={2} />
                    </span>
                    <CardTitle className="mt-4">{capability.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">
                      {capability.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Briefcase className="size-4" strokeWidth={2} />
          Included with your GrowthOS workspace — no separate signup
        </span>
      </Container>
    </section>
  );
}

export default CareerAgentSection;
export { CareerAgentSection };
