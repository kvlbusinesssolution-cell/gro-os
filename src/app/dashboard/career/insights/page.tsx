import Link from "next/link";
import { ArrowLeft, TrendingUp, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getCareerAnalytics, getJobMarketIntelligence, getCareerInsights, type TimePeriod } from "../_lib/analytics-actions";
import type { RateObservation } from "@/lib/career/outcome-analytics";

interface InsightsSearchParams {
  profile?: string;
  period?: string;
}

const PERIOD_OPTIONS: TimePeriod[] = ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "ALL_TIME"];
const PERIOD_LABELS: Record<TimePeriod, string> = {
  TODAY: "Today",
  LAST_7_DAYS: "Last 7 days",
  LAST_30_DAYS: "Last 30 days",
  LAST_90_DAYS: "Last 90 days",
  ALL_TIME: "All time",
};

function RateBadge({ obs }: { obs: RateObservation }) {
  const color = obs.sampleClassification === "INSUFFICIENT_DATA" ? "secondary" : obs.confidence === "HIGH" ? "accent" : obs.confidence === "MEDIUM" ? "default" : "secondary";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{obs.rate !== null ? `${Math.round(obs.rate * 100)}%` : "—"}</span>
        <Badge variant={color as "accent" | "default" | "secondary"} className="text-[10px]">
          {obs.sampleClassification} · {obs.confidence}
        </Badge>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {obs.numerator}/{obs.denominator}
      </span>
    </div>
  );
}

/**
 * Phase 22 (Career Learning + Job Market Intelligence) — the real career
 * analytics / market intelligence / AI insights dashboard (§35, §73). Every
 * number below is a real, on-demand computed query against actual
 * JobApplication/Job/JobMatch/CareerInterview/RecruiterCommunication rows
 * — nothing is fabricated, and small samples are shown with their real
 * INSUFFICIENT_DATA/LOW_SAMPLE classification rather than hidden (§60).
 */
export default async function CareerInsightsPage({ searchParams }: { searchParams: Promise<InsightsSearchParams> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/insights");
  const params = await searchParams;

  const profiles = await prisma.careerProfile.findMany({
    where: { userId, organizationId: membership.organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  if (profiles.length === 0) {
    return (
      <main className="py-8">
        <Container className="flex flex-col gap-6">
          <Link href="/dashboard/career" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <Card glass>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Create a career profile first.</CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const activeProfile = profiles.find((p) => p.id === params.profile) ?? profiles[0];
  const period: TimePeriod = PERIOD_OPTIONS.includes(params.period as TimePeriod) ? (params.period as TimePeriod) : "ALL_TIME";

  const [analytics, market, insights] = await Promise.all([
    getCareerAnalytics(activeProfile.id, period),
    getJobMarketIntelligence(),
    getCareerInsights(activeProfile.id),
  ]);

  if (!analytics.ok || !insights.ok) {
    return (
      <main className="py-8">
        <Container>
          <Card glass>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">{("error" in analytics && analytics.error) || "Unable to load insights."}</CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const { funnel, resumePerformance, sourcePerformance, rolePerformance, companyPerformance, skillGaps } = analytics;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/career" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <div className="flex gap-2">
            <form action="/dashboard/career/insights" className="flex gap-2">
              <Select name="profile" defaultValue={activeProfile.id}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select name="period" defaultValue={period}>
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </Select>
              <button type="submit" className="rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Apply
              </button>
            </form>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Career Insights</h1>
          <p className="text-sm text-muted-foreground">
            Every number below is ACTUAL (directly recorded) or OBSERVATION (a real pattern in actual data, never a causal claim) — small samples are shown honestly, not hidden.
          </p>
        </div>

        {/* ===== Application Funnel (ACTUAL) — §35 CAREER OVERVIEW + APPLICATION FUNNEL ===== */}
        <Card glass>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Badge variant="default">ACTUAL</Badge>
              <p className="text-sm font-medium text-foreground">Application Funnel — {PERIOD_LABELS[period]}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {(
                [
                  ["Discovered", funnel.discovered],
                  ["Matched", funnel.matched],
                  ["Shortlisted", funnel.shortlisted],
                  ["Applications", funnel.applications],
                  ["Responded", funnel.responded],
                  ["Interviews", funnel.interviews],
                  ["Offers", funnel.offers],
                  ["Rejections", funnel.rejections],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-3 text-center">
                  <p className="text-lg font-semibold text-foreground">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              No-response window: {funnel.noResponseObservationWindowDays} days — {funnel.noResponse} application(s) genuinely past that window with no real response evidence. Accepted jobs: {funnel.acceptedJobs} (this codebase has no separate accepted-job confirmation step yet — never inferred from an offer alone).
            </p>
          </CardContent>
        </Card>

        {/* ===== Resume / CV performance (OBSERVATION) ===== */}
        <Card glass>
          <CardContent className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <Badge>OBSERVATION</Badge>
              <p className="text-sm font-medium text-foreground">Resume Performance</p>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">{resumePerformance.controlsNote}</p>
            {resumePerformance.versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No applications with a selected resume yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {resumePerformance.versions.map((v) => (
                  <div key={v.resumeId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="text-sm font-medium text-foreground">Resume v{v.resumeVersion ?? "?"} — {v.applications} applications</div>
                    <div className="flex gap-4">
                      <RateBadge obs={v.responseRate} />
                      <RateBadge obs={v.interviewRate} />
                      <RateBadge obs={v.offerRate} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Source / Role / Company performance ===== */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card glass>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <Badge>OBSERVATION</Badge>
                <p className="text-sm font-medium text-foreground">Job Source Performance</p>
              </div>
              {sourcePerformance.sources.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : sourcePerformance.sources.map((s) => (
                <div key={s.provider} className="mb-2 flex items-center justify-between border-b border-border/50 pb-2 text-xs last:border-0">
                  <span className="text-foreground">{s.provider}</span>
                  <span className="text-muted-foreground">
                    {s.applications} apps · {s.responseRate.sampleClassification}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <Badge>OBSERVATION</Badge>
                <p className="text-sm font-medium text-foreground">Role Performance</p>
              </div>
              {rolePerformance.roles.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : rolePerformance.roles.slice(0, 8).map((r) => (
                <div key={r.roleTitle} className="mb-2 flex items-center justify-between border-b border-border/50 pb-2 text-xs last:border-0">
                  <span className="truncate text-foreground">{r.roleTitle}</span>
                  <span className="shrink-0 text-muted-foreground">{r.applications} apps</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <Badge>OBSERVATION</Badge>
                <p className="text-sm font-medium text-foreground">Company Performance</p>
              </div>
              {companyPerformance.companies.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : companyPerformance.companies.slice(0, 8).map((c) => (
                <div key={c.company} className="mb-2 flex items-center justify-between border-b border-border/50 pb-2 text-xs last:border-0">
                  <span className="truncate text-foreground">{c.company}</span>
                  <span className="shrink-0 text-muted-foreground">{c.medianResponseDays !== null ? `${Math.round(c.medianResponseDays)}d median response` : "—"}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ===== Job Market Intelligence ===== */}
        <Card glass>
          <CardContent className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <p className="text-sm font-medium text-foreground">Job Market Intelligence</p>
              {market.ok && <Badge variant={market.snapshot.sourceQuality === "UNKNOWN" ? "secondary" : "default"}>{market.snapshot.sourceQuality} quality</Badge>}
            </div>
            {market.ok ? (
              <>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Based on {market.snapshot.sampleSize} real job postings collected from {market.snapshot.sources.join(", ") || "no configured sources yet"} ({market.snapshot.geography}), {market.snapshot.collectionPeriodStart.toDateString()}–{market.snapshot.collectionPeriodEnd.toDateString()}.
                </p>
                {market.snapshot.sampleSize === 0 ? (
                  <p className="text-sm text-muted-foreground">INSUFFICIENT_DATA — no jobs discovered yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-foreground">Top skills</p>
                      {(market.snapshot.skillDistribution as { key: string; jobCount: number; percentage: number }[]).slice(0, 8).map((s) => (
                        <div key={s.key} className="flex justify-between text-xs text-muted-foreground">
                          <span>{s.key}</span>
                          <span>{s.percentage}% ({s.jobCount})</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-foreground">Work mode</p>
                      {(market.snapshot.workModeDistribution as { key: string; jobCount: number; percentage: number }[]).map((s) => (
                        <div key={s.key} className="flex justify-between text-xs text-muted-foreground">
                          <span>{s.key}</span>
                          <span>{s.percentage}% ({s.jobCount})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{market.error}</p>
            )}
          </CardContent>
        </Card>

        {/* ===== Skill Gaps ===== */}
        <Card glass>
          <CardContent className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <Badge>OBSERVATION</Badge>
              <p className="text-sm font-medium text-foreground">Skill Gaps</p>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">{skillGaps.marketDemandNote}</p>
            {skillGaps.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matched jobs yet to analyze requirements against.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {skillGaps.gaps.slice(0, 20).map((g) => (
                  <Badge key={g.skill} variant={g.userEvidenceStatus === "MISSING" ? "outline" : g.userEvidenceStatus === "NEEDS_VERIFICATION" ? "secondary" : "default"} className={g.userEvidenceStatus === "MISSING" ? "border-destructive/40 text-destructive" : undefined}>
                    {g.skill} ({g.relevantJobCount}) — {g.userEvidenceStatus}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== AI Insights (mixed ACTUAL/OBSERVATION/RECOMMENDATION, explicitly labeled) ===== */}
        <Card glass>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <p className="text-sm font-medium text-foreground">AI Insights</p>
            </div>

            <p className="mb-1 text-xs font-semibold text-foreground">What should I apply to today?</p>
            {insights.applyToday.length === 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">No new matched jobs without an existing application right now.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1">
                {insights.applyToday.slice(0, 5).map((item) => (
                  <li key={item.jobMatchId} className="text-xs text-muted-foreground">
                    <Link href={`/dashboard/career/jobs/${item.jobId}`} className="text-foreground hover:underline">
                      {item.title} @ {item.company}
                    </Link>{" "}
                    — score {item.actualMatch.overallScore}, {item.actualMatch.eligibility}
                  </li>
                ))}
              </ul>
            )}

            <p className="mb-1 text-xs font-semibold text-foreground">What needs follow-up?</p>
            {insights.needsFollowUp.length === 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">Nothing due.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1">
                {insights.needsFollowUp.map((f) => (
                  <li key={f.applicationId + f.dayOffset} className="text-xs text-muted-foreground">
                    {f.jobTitle} @ {f.company} — day {f.dayOffset} follow-up due ({f.daysElapsedSinceSubmission ?? "?"} days since submission)
                  </li>
                ))}
              </ul>
            )}

            <p className="mb-1 text-xs font-semibold text-foreground">Who replied?</p>
            {insights.whoRepliedList.length === 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">No recruiter replies yet.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1">
                {insights.whoRepliedList.slice(0, 5).map((w, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {w.company} — {w.role} — {w.classification} — {w.date.toDateString()}
                  </li>
                ))}
              </ul>
            )}

            <p className="mb-1 text-xs font-semibold text-foreground">Upcoming interviews</p>
            {insights.upcomingInterviews.length === 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">None scheduled.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1">
                {insights.upcomingInterviews.map((iv, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {iv.company} — {iv.role} — {iv.status}{iv.localDate ? ` — ${iv.localDate} ${iv.localTime ?? ""} ${iv.timezone ?? ""}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
