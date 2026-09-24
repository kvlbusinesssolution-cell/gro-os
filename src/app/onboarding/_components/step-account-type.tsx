"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { Building2, UserSearch, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { EASES } from "@/animations";
import type { OrganizationType } from "@/generated/prisma/client";

interface AccountTypeOption {
  type: OrganizationType;
  title: string;
  description: string;
  icon: typeof Building2;
}

const OPTIONS: AccountTypeOption[] = [
  {
    type: "BUSINESS",
    title: "I run a business",
    description: "CRM, outreach, proposals, and an AI workforce that runs your whole growth engine.",
    icon: Building2,
  },
  {
    type: "CAREER",
    title: "I'm looking for a job",
    description: "Your own career workspace — CV builder, job search, applications, and interviews.",
    icon: UserSearch,
  },
];

/**
 * Onboarding's real first screen — decides Organization.type once, up
 * front, before any business-specific wizard step ever renders. Choosing
 * "I'm looking for a job" skips the rest of this wizard entirely (see
 * OnboardingWizard) since company profile / business details / services
 * are meaningless for a personal career workspace.
 */
export function StepAccountType({ onChoose }: { onChoose: (type: OrganizationType) => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [selecting, setSelecting] = useState<OrganizationType | null>(null);

  function choose(type: OrganizationType) {
    setSelecting(type);
    startTransition(async () => {
      await onChoose(type);
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelecting = pending && selecting === option.type;
        return (
          <motion.button
            key={option.type}
            type="button"
            disabled={pending}
            onClick={() => choose(option.type)}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2, ease: EASES.outExpo }}
            className={cn(
              "flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6 text-left transition-colors duration-150 hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              {isSelecting ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
            </span>
            <span className="text-lg font-semibold text-foreground">{option.title}</span>
            <span className="text-sm text-muted-foreground">{option.description}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
