import Link from "next/link";
import { Briefcase, FileText, Star, Plus, AlertCircle } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { computeCareerProfileCompleteness } from "@/lib/career/profile-completeness";

/**
 * Phase 18 (AI Career Agent Foundation) — the Career command center. Every
 * number here is a real query against CareerProfile/CareerResume rows this
 * user actually owns — no job/application/interview counts are shown
 * because that data genuinely doesn't exist yet (Phase 19+ scope, not
 * faked here with a placeholder "0").
 */
export default async function CareerDashboardPage() {
  const { userId, membership } = await requireActiveMembership("/dashboard/career");
  const organizationId = membership.organizationId;

  const profiles = await prisma.careerProfile.findMany({
    where: { userId, organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    include: {
      resumes: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Career</h1>
            <p className="text-sm text-muted-foreground">
              Your personal career profile(s) and resume — foundation for AI-assisted job matching in a
              future phase. Nothing on this page is fabricated: job discovery, applications and interviews
              aren&apos;t built yet, so they simply don&apos;t appear here.
            </p>
          </div>
          <Link
            href="/dashboard/career/profile"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> {profiles.length === 0 ? "Create your first profile" : "Manage profiles"}
          </Link>
        </div>

        {profiles.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Briefcase className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No career profile yet. Create one to upload a resume and set your target roles/preferences —
                the real foundation the AI Career Agent uses.
              </p>
              <Link href="/dashboard/career/profile" className="text-sm font-medium text-primary hover:underline">
                Create a career profile
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => {
              const latestResume = profile.resumes[0];
              const completeness = computeCareerProfileCompleteness({
                currentRole: profile.currentRole,
                location: profile.location,
                yearsOfExperience: profile.yearsOfExperience,
                skills: profile.skills,
                education: profile.education,
                experienceHasResume: !!latestResume,
                githubUrl: profile.githubUrl,
                linkedinUrl: profile.linkedinUrl,
                websiteUrl: profile.websiteUrl,
                portfolioUrl: profile.portfolioUrl,
                targetRoles: profile.targetRoles,
                industries: profile.industries,
              });

              return (
                <Link key={profile.id} href={`/dashboard/career/profile/${profile.id}`}>
                  <Card glass className="h-full transition-transform duration-150 hover:-translate-y-0.5">
                    <CardContent className="flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Briefcase className="size-4" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{profile.name}</p>
                            {profile.currentRole && <p className="text-xs text-muted-foreground">{profile.currentRole}</p>}
                          </div>
                        </div>
                        {profile.isPrimary && (
                          <Badge variant="accent" className="flex items-center gap-1">
                            <Star className="size-3" /> Primary
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="size-3.5" />
                        {latestResume ? (
                          <span>Resume v{latestResume.version} — {latestResume.status.replace(/_/g, " ").toLowerCase()}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertCircle className="size-3.5" /> No resume uploaded
                          </span>
                        )}
                      </div>

                      <div className="mt-1 border-t border-border pt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Profile completeness</span>
                          <span className="font-medium text-foreground">{completeness.score}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completeness.score}%` }} />
                        </div>
                        {completeness.missingSections.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Missing: {completeness.missingSections.slice(0, 2).join(", ")}
                            {completeness.missingSections.length > 2 ? ` +${completeness.missingSections.length - 2} more` : ""}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        <Card glass>
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-sm font-medium text-foreground">AI Career Agent</p>
              <p className="text-xs text-muted-foreground">Ask about your own stored profile data — no fabricated jobs or applications.</p>
            </div>
            <Link href="/dashboard/career/agent" className="text-sm font-medium text-primary hover:underline">
              Open agent →
            </Link>
          </CardContent>
        </Card>

        {profiles.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Job Search</p>
                  <p className="text-xs text-muted-foreground">Real jobs from Remotive, matched against your profile.</p>
                </div>
                <Link href="/dashboard/career/job-search" className="text-sm font-medium text-primary hover:underline">
                  Search jobs →
                </Link>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Matched Jobs</p>
                  <p className="text-xs text-muted-foreground">Review, filter and shortlist real discovered jobs.</p>
                </div>
                <Link href="/dashboard/career/jobs" className="text-sm font-medium text-primary hover:underline">
                  View jobs →
                </Link>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Applications</p>
                  <p className="text-xs text-muted-foreground">Track real applications — eligibility, documents, submission status.</p>
                </div>
                <Link href="/dashboard/career/applications" className="text-sm font-medium text-primary hover:underline">
                  View applications →
                </Link>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Career Inbox</p>
                  <p className="text-xs text-muted-foreground">Real recruiter replies, classified and matched to your applications.</p>
                </div>
                <Link href="/dashboard/career/messages" className="text-sm font-medium text-primary hover:underline">
                  Open inbox →
                </Link>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Interviews</p>
                  <p className="text-xs text-muted-foreground">Real interview requests — review, accept, or request another slot.</p>
                </div>
                <Link href="/dashboard/career/interviews" className="text-sm font-medium text-primary hover:underline">
                  View interviews →
                </Link>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Insights</p>
                  <p className="text-xs text-muted-foreground">Real outcome analytics, job market intelligence and AI-answered career questions.</p>
                </div>
                <Link href="/dashboard/career/insights" className="text-sm font-medium text-primary hover:underline">
                  View insights →
                </Link>
              </CardContent>
            </Card>
          </div>
        )}
      </Container>
    </main>
  );
}
