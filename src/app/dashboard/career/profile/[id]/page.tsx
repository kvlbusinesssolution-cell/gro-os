import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { ProfileEditForm } from "./_components/profile-edit-form";
import { ResumePanel } from "./_components/resume-panel";
import { ProfileActionsBar } from "./_components/profile-actions-bar";
import { computeCareerProfileCompleteness } from "@/lib/career/profile-completeness";

export default async function CareerProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, membership } = await requireActiveMembership(`/dashboard/career/profile/${id}`);
  const organizationId = membership.organizationId;

  const profile = await prisma.careerProfile.findUnique({
    where: { id },
    include: { resumes: { orderBy: { version: "desc" } } },
  });

  // Real ownership check — a profile belonging to another user or another
  // organization renders as a plain 404, never a leaked "not authorized"
  // that would confirm the id exists (§20/§31 IDOR protection).
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) {
    notFound();
  }

  const completeness = computeCareerProfileCompleteness({
    currentRole: profile.currentRole,
    location: profile.location,
    yearsOfExperience: profile.yearsOfExperience,
    skills: profile.skills,
    education: profile.education,
    experienceHasResume: profile.resumes.length > 0,
    githubUrl: profile.githubUrl,
    linkedinUrl: profile.linkedinUrl,
    websiteUrl: profile.websiteUrl,
    portfolioUrl: profile.portfolioUrl,
    targetRoles: profile.targetRoles,
    industries: profile.industries,
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Back to Career
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{profile.name}</h1>
            <p className="text-sm text-muted-foreground">
              {completeness.score}% complete
              {completeness.missingSections.length > 0 && ` — missing: ${completeness.missingSections.join(", ")}`}
            </p>
          </div>
          <ProfileActionsBar careerProfileId={profile.id} isPrimary={profile.isPrimary} />
        </div>

        <ResumePanel
          careerProfileId={profile.id}
          resumes={profile.resumes.map((r) => ({
            id: r.id,
            version: r.version,
            originalFilename: r.originalFilename,
            status: r.status,
            failureReason: r.failureReason,
            aiConfidence: r.aiConfidence,
            aiExtractedProfile: r.aiExtractedProfile as Record<string, unknown> | null,
            userVerifiedFields: r.userVerifiedFields as Record<string, boolean> | null,
            uploadedAt: r.uploadedAt.toISOString(),
          }))}
        />

        <ProfileEditForm
          profile={{
            id: profile.id,
            name: profile.name,
            currentRole: profile.currentRole,
            careerLevel: profile.careerLevel,
            yearsOfExperience: profile.yearsOfExperience,
            location: profile.location,
            industries: profile.industries,
            portfolioUrl: profile.portfolioUrl,
            githubUrl: profile.githubUrl,
            linkedinUrl: profile.linkedinUrl,
            websiteUrl: profile.websiteUrl,
            targetRoles: profile.targetRoles,
            targetCountries: profile.targetCountries,
            targetCities: profile.targetCities,
            workMode: profile.workMode,
            salaryMin: profile.salaryMin,
            salaryMax: profile.salaryMax,
            salaryCurrency: profile.salaryCurrency,
            employmentTypes: profile.employmentTypes,
            experienceLevelMinYears: profile.experienceLevelMinYears,
            experienceLevelMaxYears: profile.experienceLevelMaxYears,
            preferredTechnologies: profile.preferredTechnologies,
            excludedTechnologies: profile.excludedTechnologies,
            preferredCompanies: profile.preferredCompanies,
            excludedCompanies: profile.excludedCompanies,
            relocationPreference: profile.relocationPreference,
            noticePeriodDays: profile.noticePeriodDays,
          }}
        />
      </Container>
    </main>
  );
}
