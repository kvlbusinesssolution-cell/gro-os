"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { DURATIONS, EASES } from "@/animations";
import type { Organization, OrganizationType } from "@/generated/prisma/client";
import type {
  BusinessDetailsInput,
  CompanyProfileInput,
  ServicesGoalsInput,
} from "@/lib/validations/onboarding";
import { chooseAccountType, updateBusinessDetails, updateCompanyProfile, updateServicesGoals } from "../actions";
import { OnboardingProgressBar, WIZARD_STEPS } from "./progress-bar";
import { StepAccountType } from "./step-account-type";
import { StepBusinessDetails } from "./step-business-details";
import { StepCompanyProfile } from "./step-company-profile";
import { StepServicesGoals } from "./step-services-goals";
import { SuccessScreen } from "./success-screen";

const STEP_DESCRIPTIONS = [
  "The essentials your AI agents need to represent your company correctly, everywhere.",
  "How big you are and where you do business — used to calibrate outreach and pricing conversations.",
  "What you sell, who you sell it to, and what you want your AI workforce to spend its time on.",
];

function toCompanyProfileForm(org: Organization): CompanyProfileInput {
  return {
    name: org.name,
    logo: org.logo ?? "",
    industry: org.industry ?? "",
    website: org.website ?? "",
    email: org.email ?? "",
    phone: org.phone ?? "",
    gstNumber: org.gstNumber ?? "",
    registrationNumber: org.registrationNumber ?? "",
    linkedin: org.linkedin ?? "",
    facebook: org.facebook ?? "",
    twitter: org.twitter ?? "",
    description: org.description ?? "",
  };
}

function toBusinessDetailsForm(org: Organization): BusinessDetailsInput {
  return {
    companySize: org.companySize ?? undefined,
    annualRevenue: org.annualRevenue ?? "",
    primaryMarket: org.primaryMarket ?? "",
    countriesServed: org.countriesServed,
    primaryLanguage: org.primaryLanguage ?? "",
    currency: org.currency ?? "",
    timezone: org.timezone ?? "",
  };
}

function toServicesGoalsForm(org: Organization): ServicesGoalsInput {
  return {
    services: org.services,
    clientTypes: org.clientTypes,
    aiGoals: org.aiGoals,
  };
}

export function OnboardingWizard({ organization: initialOrganization }: { organization: Organization }) {
  const router = useRouter();
  const [organization, setOrganization] = useState(initialOrganization);
  const [currentStep, setCurrentStep] = useState(() => Math.min(organization.onboardingStep + 1, 3));
  const [showSuccess, setShowSuccess] = useState(organization.onboardingStep >= 3);

  async function handleChooseAccountType(type: OrganizationType) {
    const result = await chooseAccountType(organization.id, type);
    if (!result.ok || !result.organization) return;
    if (type === "CAREER") {
      router.push("/dashboard/career");
      return;
    }
    setOrganization(result.organization);
  }

  async function handleSaveCompanyProfile(data: CompanyProfileInput) {
    const result = await updateCompanyProfile(organization.id, data);
    if (result.ok && result.organization) {
      setOrganization(result.organization);
      setCurrentStep(2);
    }
    return { ok: result.ok, error: result.error };
  }

  async function handleSaveBusinessDetails(data: BusinessDetailsInput) {
    const result = await updateBusinessDetails(organization.id, data);
    if (result.ok && result.organization) {
      setOrganization(result.organization);
      setCurrentStep(3);
    }
    return { ok: result.ok, error: result.error };
  }

  async function handleSaveServicesGoals(data: ServicesGoalsInput) {
    const result = await updateServicesGoals(organization.id, data);
    if (result.ok && result.organization) {
      setOrganization(result.organization);
      setShowSuccess(true);
    }
    return { ok: result.ok, error: result.error };
  }

  if (!organization.accountTypeConfirmed) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6 py-16">
        <Container className="max-w-2xl">
          <div className="flex flex-col gap-8">
            <SectionHeading
              align="left"
              eyebrow="Welcome"
              title="What brings you here?"
              description="This decides your workspace — you can't switch it later without creating a new account."
            />
            <StepAccountType onChoose={handleChooseAccountType} />
          </div>
        </Container>
      </main>
    );
  }

  if (showSuccess) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6 py-16">
        <Container className="max-w-2xl">
          <Card glass className="w-full">
            <CardContent className="pt-6">
              <SuccessScreen organizationName={organization.name} organizationId={organization.id} />
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  return (
    <main className="min-h-svh bg-background px-6 py-16">
      <Container className="max-w-3xl">
        <div className="flex flex-col gap-8">
          <SectionHeading
            align="left"
            eyebrow="Set up your workspace"
            title="Tell us about your business"
            description="Every answer here trains your AI workforce to sound like you, target the right leads, and prioritize the right work — you can always change this later."
          />

          <OnboardingProgressBar
            currentStep={currentStep}
            maxUnlockedStep={organization.onboardingStep}
            onStepSelect={setCurrentStep}
          />

          <Card glass>
            <CardHeader>
              <CardTitle>{WIZARD_STEPS[currentStep - 1].label}</CardTitle>
              <CardDescription>{STEP_DESCRIPTIONS[currentStep - 1]}</CardDescription>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: DURATIONS.slow, ease: EASES.outExpo }}
                >
                  {currentStep === 1 && (
                    <StepCompanyProfile
                      organizationId={organization.id}
                      initial={toCompanyProfileForm(organization)}
                      onSave={handleSaveCompanyProfile}
                    />
                  )}
                  {currentStep === 2 && (
                    <StepBusinessDetails
                      initial={toBusinessDetailsForm(organization)}
                      onSave={handleSaveBusinessDetails}
                    />
                  )}
                  {currentStep === 3 && (
                    <StepServicesGoals
                      initial={toServicesGoalsForm(organization)}
                      onSave={handleSaveServicesGoals}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}
