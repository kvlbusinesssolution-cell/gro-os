import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { logAudit } from "@/lib/audit";
import { isAIConnected } from "@/lib/ai/client";
import { runWebSearchDiscovery } from "@/lib/ai/agent-runtime";
import { addCompanyTimelineEvent } from "@/lib/company-intelligence";
import { scoreCompany } from "@/lib/lead-scoring";
import { sendEmail } from "@/lib/email";
import { generateEmailDraft } from "@/lib/outreach/draft-generator";
import { sendOutreachEmail } from "@/lib/outreach/email-provider";
import { injectTracking, getAppBaseUrl } from "@/lib/outreach/tracking";
import type { JobRunLog } from "@/lib/scheduler/types";
import type { Company, AIAgentInstance, PipelineStage } from "@/generated/prisma/client";

import { findOrCreateCompany } from "./dedup";

/**
 * KVL-only lead discovery + outreach, scoped to KVL's own organization only
 * (resolved by owner email below) so it never runs unbounded AI-cost work
 * against every tenant on the platform. Distinct from the generic, per-org
 * opt-in `lead-discovery` job (discovery-job.ts, 6am, capped at 3 queries).
 *
 * Scheduling (see registry.ts): one job PER TARGET COUNTRY, each firing at
 * 10:30 AM in that country's own local timezone (BullMQ's cron `tz` option —
 * confirmed this is the active scheduler provider, see scheduler/init.ts —
 * genuinely evaluates the cron pattern in the given zone), so outreach to a
 * given country always starts when that country's business day starts, not
 * at a fixed IST time. A separate daily catch-up job (8pm IST) tops up to
 * the DAILY_MIN floor if the day's country runs came in short, and a daily
 * report job (9pm IST) emails the owner a real send/open/click summary —
 * see runKvlCountryOutreach / runKvlDailyCatchup / sendKvlDailyReport below.
 */
export const KVL_OWNER_EMAIL = "kamaralamjdu@gmail.com";
const DIGEST_RECIPIENTS = ["kvlbusinesssolution@gmail.com"];
const DAILY_MIN = 20;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface CountryQuery {
  country: string;
  query: string;
}

interface SectorTarget {
  label: string;
  countries: CountryQuery[];
}

// Country-specific rather than a vague "outside India" catch-all — Razorpay's
// own merchant base is ~89% India, ~8% US, ~1% UK, with everywhere else in
// single digits combined, and its Southeast Asia business runs under a
// separate "Curlec by Razorpay" brand (Malaysia, regulated by Bank Negara
// Malaysia) rather than the Razorpay name — so a search for "Razorpay" alone
// would never surface those merchants. UAE/Saudi Arabia aren't part of
// Razorpay's known merchant base as of this writing, so those two queries may
// honestly come back empty most runs — `runWebSearchDiscovery` never
// fabricates a company that didn't actually show up in search results, it'll
// just report 0 found for that country rather than making something up.
// Dubai gets two query phrasings (its own entry plus the wider-UAE one) per
// sector — the requested "extra focus" — while every other country still
// gets guaranteed at least one real search per sector, every run.
const SECTOR_TARGETS: SectorTarget[] = [
  {
    label: "E-commerce/D2C brands",
    countries: [
      { country: "India", query: "D2C and e-commerce brands in India that use Razorpay for online payments" },
      { country: "Dubai, UAE", query: "e-commerce and D2C brands based in Dubai using Razorpay payment gateway" },
      { country: "UAE", query: "online retail businesses in the United Arab Emirates using Razorpay payment gateway" },
      { country: "Saudi Arabia", query: "e-commerce and online retail businesses in Saudi Arabia using Razorpay payment gateway" },
      { country: "United States", query: "e-commerce and online retail businesses in the United States using Razorpay payment gateway" },
      { country: "United Kingdom", query: "online retail businesses in the United Kingdom using Razorpay payment gateway" },
      { country: "Malaysia", query: "e-commerce and online retail businesses in Malaysia using Curlec by Razorpay for online payments" },
    ],
  },
  {
    label: "SaaS/Software companies",
    countries: [
      { country: "India", query: "SaaS and software companies in India that use Razorpay for subscription billing" },
      { country: "Dubai, UAE", query: "SaaS and software companies based in Dubai using Razorpay payment gateway" },
      { country: "UAE", query: "SaaS and software companies in the United Arab Emirates using Razorpay payment gateway" },
      { country: "Saudi Arabia", query: "SaaS and software companies in Saudi Arabia using Razorpay payment gateway" },
      { country: "United States", query: "SaaS and software companies in the United States using Razorpay payment gateway" },
      { country: "United Kingdom", query: "SaaS and software companies in the United Kingdom using Razorpay payment gateway" },
      { country: "Malaysia", query: "SaaS and software companies in Malaysia using Curlec by Razorpay for subscription billing" },
    ],
  },
  {
    label: "EdTech",
    countries: [
      { country: "India", query: "EdTech and online education platforms in India using Razorpay for course payments" },
      { country: "Dubai, UAE", query: "EdTech and online education platforms based in Dubai using Razorpay payment gateway" },
      { country: "UAE", query: "EdTech and online education platforms in the United Arab Emirates using Razorpay payment gateway" },
      { country: "Saudi Arabia", query: "EdTech and online education platforms in Saudi Arabia using Razorpay payment gateway" },
      { country: "United States", query: "EdTech and online education platforms in the United States using Razorpay payment gateway" },
      { country: "United Kingdom", query: "EdTech and online education platforms in the United Kingdom using Razorpay payment gateway" },
      { country: "Malaysia", query: "EdTech and online education platforms in Malaysia using Curlec by Razorpay for course payments" },
    ],
  },
  {
    label: "Healthcare/Clinics",
    countries: [
      { country: "India", query: "healthcare clinics and health-tech companies in India using Razorpay for payments" },
      { country: "Dubai, UAE", query: "healthcare clinics and health-tech companies based in Dubai using Razorpay payment gateway" },
      { country: "UAE", query: "healthcare clinics and health-tech companies in the United Arab Emirates using Razorpay payment gateway" },
      { country: "Saudi Arabia", query: "healthcare clinics and health-tech companies in Saudi Arabia using Razorpay payment gateway" },
      { country: "United States", query: "healthcare clinics and health-tech companies in the United States using Razorpay payment gateway" },
      { country: "United Kingdom", query: "healthcare clinics and health-tech companies in the United Kingdom using Razorpay payment gateway" },
      { country: "Malaysia", query: "healthcare clinics and health-tech companies in Malaysia using Curlec by Razorpay for payments" },
    ],
  },
];

/**
 * One job per group below (see registry.ts), each scheduled at 10:30 AM in
 * `timezone` — that IANA zone is the real local business-hours clock this
 * group's outreach starts by, not a guess folded into a single IST time.
 * `countryNames` matches SECTOR_TARGETS' `country` field; UAE bundles both
 * its "Dubai, UAE" and "UAE" query entries into one group/timezone since
 * they're the same country. USA uses America/New_York as the single
 * representative US business-hours zone (the country spans several).
 */
const COUNTRY_GROUPS: { key: string; label: string; timezone: string; countryNames: string[] }[] = [
  { key: "india", label: "India", timezone: "Asia/Kolkata", countryNames: ["India"] },
  { key: "uae", label: "UAE", timezone: "Asia/Dubai", countryNames: ["Dubai, UAE", "UAE"] },
  { key: "saudi", label: "Saudi Arabia", timezone: "Asia/Riyadh", countryNames: ["Saudi Arabia"] },
  { key: "usa", label: "United States", timezone: "America/New_York", countryNames: ["United States"] },
  { key: "uk", label: "United Kingdom", timezone: "Europe/London", countryNames: ["United Kingdom"] },
  { key: "malaysia", label: "Malaysia", timezone: "Asia/Kuala_Lumpur", countryNames: ["Malaysia"] },
];

type OutreachStatus = "sent" | "failed" | "skipped_no_email" | "already_contacted";

interface FoundCompany {
  name: string;
  website: string | null;
  email: string | null;
  reason: string | null;
  country: string;
  sector: string;
  outreach: OutreachStatus;
}

export const KVL_OUTREACH_CAMPAIGN_NAME = "KVL Sector Outreach";

/** Start of "today" in IST, as a real UTC Date instant — used for every "how many did we already send today" query so the daily floor and the report both agree on what day a send counted toward. */
function startOfTodayIST(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const startIstMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0) - IST_OFFSET_MS;
  return new Date(startIstMs);
}

/** Finds or creates the one standing, auto-approved campaign every KVL-discovered lead with a real email gets enrolled into — see [[kvl-client-acquisition-priority]]-style intent: KVL runs zero manual-review friction on its own outbound, unlike every other org's campaigns which stay MANUAL by default. */
async function ensureKvlOutreachCampaign(organizationId: string, createdByUserId: string): Promise<string> {
  const existing = await prisma.campaign.findFirst({ where: { organizationId, name: KVL_OUTREACH_CAMPAIGN_NAME } });
  if (existing) return existing.id;

  const campaign = await prisma.campaign.create({
    data: {
      organizationId,
      name: KVL_OUTREACH_CAMPAIGN_NAME,
      type: "STANDARD",
      status: "ACTIVE",
      approvalMode: "AUTOMATIC",
      goal: "Convert discovered Razorpay-merchant prospects into KVL Business Solutions clients — first-touch email sent automatically, no manual approval step.",
      createdByUserId,
    },
  });
  return campaign.id;
}

/**
 * Real send, no human in the loop: generates one AI-written introduction
 * email for a newly-discovered company and pushes it straight through
 * APPROVED -> QUEUED -> SENT (mirrors approval-actions.ts's sendQueuedDraft,
 * minus the session/Approval-row ceremony that only exists for
 * human-reviewed campaigns). Skips outright if a Contact with this email
 * already exists for the org — never re-emails a company already reached on
 * a prior run. Returns why outreach did/didn't happen, never throws — a
 * single bad send must not abort the rest of the run.
 */
async function autoOutreachToCompany(organizationId: string, campaignId: string, company: Company, email: string | null): Promise<OutreachStatus> {
  if (!email) return "skipped_no_email";

  const existingContact = await prisma.contact.findFirst({ where: { organizationId, email } });
  if (existingContact) return "already_contacted";

  const contact = await prisma.contact.create({
    data: { organizationId, companyId: company.id, firstName: "Team", email, country: company.headquartersCountry ?? null },
  });

  await prisma.campaignContact.create({ data: { campaignId, contactId: contact.id } });

  try {
    const draft = await generateEmailDraft({ contactId: contact.id, purpose: "INTRODUCTION", tone: "PROFESSIONAL", channel: "EMAIL", campaignId });

    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "QUEUED", queuedAt: new Date() } });

    const baseUrl = getAppBaseUrl();
    const rawHtml = `<p>${draft.body.replace(/\n/g, "<br/>")}</p>`;
    const html = draft.trackingToken ? injectTracking(rawHtml, draft.trackingToken, baseUrl) : rawHtml;

    const result = await sendOutreachEmail(organizationId, { to: email, subject: draft.subject ?? `Working with ${company.name}`, html, text: draft.body });

    if (!result.ok) {
      await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedReason: result.error } });
      return "failed";
    }

    await prisma.emailDraft.update({
      where: { id: draft.id },
      data: { status: "SENT", sentAt: new Date(), resendMessageId: result.providerMessageId ?? undefined },
    });
    return "sent";
  } catch {
    return "failed";
  }
}

export async function resolveKvlOrganizationId(): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: KVL_OWNER_EMAIL }, select: { id: true } });
  if (!user) return null;
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

interface RunContext {
  organizationId: string;
  campaignId: string;
  salesAgent: AIAgentInstance;
  stage: PipelineStage;
  ownerUserId: string;
}

/** Shared setup every entry point below needs — resolves KVL's org/sales agent/pipeline stage/campaign once, or explains exactly why it can't (never a silent partial run). */
async function resolveRunContext(): Promise<{ context: RunContext } | { skipLog: JobRunLog }> {
  if (!isAIConnected()) return { skipLog: { level: "warn", message: "Skipped — no AI provider configured." } };

  const organizationId = await resolveKvlOrganizationId();
  if (!organizationId) return { skipLog: { level: "warn", message: `Skipped — no active OWNER membership found for ${KVL_OWNER_EMAIL}.` } };

  const salesAgent = await prisma.aIAgentInstance.findFirst({ where: { organizationId, type: "SALES", active: true } });
  if (!salesAgent) return { skipLog: { level: "warn", message: "Skipped — no active Sales agent for KVL's organization.", organizationId } };

  const owner = await prisma.membership.findFirst({
    where: { organizationId, status: "ACTIVE", role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (!owner) return { skipLog: { level: "warn", message: "Skipped — no active OWNER membership.", organizationId } };

  const stage = await prisma.pipelineStage.findFirst({ where: { workspace: { organizationId } }, orderBy: { order: "asc" } });
  if (!stage) return { skipLog: { level: "warn", message: "Skipped — no pipeline stage configured.", organizationId } };

  const campaignId = await ensureKvlOutreachCampaign(organizationId, owner.userId);

  return { context: { organizationId, campaignId, salesAgent, stage, ownerUserId: owner.userId } };
}

/** Runs one (sector, country, query) search, creates/dedups the Company+Lead, and auto-sends outreach for anything genuinely new. Shared by the per-country jobs and the daily catch-up. */
async function processQuery(ctx: RunContext, sectorLabel: string, country: string, query: string, logs: JobRunLog[]): Promise<{ found: FoundCompany[]; duplicatesSkipped: number }> {
  const found: FoundCompany[] = [];
  let duplicatesSkipped = 0;

  try {
    const search = await runWebSearchDiscovery({
      agentId: ctx.salesAgent.id,
      agentType: "SALES",
      agentName: ctx.salesAgent.name,
      query,
      resultKind: "lead",
    });

    for (const item of search.companies) {
      const { company, wasCreated } = await findOrCreateCompany({
        organizationId: ctx.organizationId,
        name: item.name,
        website: item.website,
        industry: item.industry,
        email: item.email,
        notes: item.reason,
        source: "AUTO_DISCOVERY",
        status: "LEAD",
      });

      if (!wasCreated) {
        const existingLead = await prisma.lead.findFirst({ where: { companyId: company.id } });
        if (existingLead) {
          duplicatesSkipped += 1;
          continue;
        }
      }

      await prisma.lead.create({
        data: { pipelineStageId: ctx.stage.id, companyId: company.id, name: item.name, company: item.name, email: item.email || null },
      });
      await addCompanyTimelineEvent({
        companyId: company.id,
        type: "CREATED",
        title: `${company.name} discovered automatically (sector: "${sectorLabel}", country: "${country}", query: "${query}")`,
        description: item.reason || null,
        source: "AI_RESEARCH",
      });
      await scoreCompany(company.id);

      const outreach = await autoOutreachToCompany(ctx.organizationId, ctx.campaignId, company, item.email ?? null);
      found.push({ name: item.name, website: item.website ?? null, email: item.email ?? null, reason: item.reason ?? null, country, sector: sectorLabel, outreach });
    }
  } catch (error) {
    logs.push({
      level: "error",
      message: `Sector "${sectorLabel}" country "${country}" query "${query}" failed: ${error instanceof Error ? error.message : String(error)}`,
      organizationId: ctx.organizationId,
    });
  }

  return { found, duplicatesSkipped };
}

function summarize(found: FoundCompany[], logs: JobRunLog[], organizationId: string, labelPrefix: string): { totalSent: number; totalFailed: number } {
  const totalSent = found.filter((f) => f.outreach === "sent").length;
  const totalFailed = found.filter((f) => f.outreach === "failed").length;
  logs.push({
    level: "info",
    message: `${labelPrefix}: ${found.length} new lead(s) found, ${totalSent} outreach email(s) sent, ${totalFailed} failed.`,
    organizationId,
  });
  return { totalSent, totalFailed };
}

/**
 * Entry point for each of the 6 per-country jobs (registry.ts) — runs only
 * the query entries belonging to this country group, at whatever moment
 * that country's own business day opens. Real work only (a handful of
 * sequential AI search + outreach calls), so it finishes in minutes, well
 * inside the 10:30am-7pm local window it started in — never scheduled to
 * run past that window's close.
 */
export async function runKvlCountryOutreach(groupKey: string): Promise<JobRunLog[]> {
  const group = COUNTRY_GROUPS.find((g) => g.key === groupKey);
  if (!group) return [{ level: "error", message: `Unknown KVL country group "${groupKey}".` }];

  const resolved = await resolveRunContext();
  if ("skipLog" in resolved) return [resolved.skipLog];
  const ctx = resolved.context;

  const logs: JobRunLog[] = [];
  const allFound: FoundCompany[] = [];
  let duplicatesSkipped = 0;

  for (const sector of SECTOR_TARGETS) {
    for (const { country, query } of sector.countries) {
      if (!group.countryNames.includes(country)) continue;
      const result = await processQuery(ctx, sector.label, country, query, logs);
      allFound.push(...result.found);
      duplicatesSkipped += result.duplicatesSkipped;
    }
  }

  const { totalSent, totalFailed } = summarize(allFound, logs, ctx.organizationId, `KVL ${group.label} outreach`);

  await logActivity({
    organizationId: ctx.organizationId,
    type: "SYSTEM_EVENT",
    description: `KVL ${group.label} business-hours outreach: ${allFound.length} new lead(s), ${totalSent} email(s) sent.`,
    actorUserId: ctx.ownerUserId,
    metadata: { group: group.key, totalFound: allFound.length, totalSent, totalFailed, duplicatesSkipped },
  });
  await logAudit({
    organizationId: ctx.organizationId,
    action: "business_development.kvl_country_outreach_run",
    metadata: { group: group.key, totalFound: allFound.length, totalSent, totalFailed },
  });

  return logs;
}

/**
 * 8pm IST safety net (registry.ts's `kvl-daily-catchup`) — the org wants a
 * genuine floor of DAILY_MIN real outreach emails/day. If today's 6
 * business-hours country runs already cleared that floor, this is a no-op.
 * If they came in short (thin search results, a provider outage during one
 * country's window, etc.), this re-runs the full query list — safe to
 * re-run because findOrCreateCompany/autoOutreachToCompany's existing
 * dedup means it only ever reaches genuinely new companies/contacts, never
 * re-emails anyone — stopping the moment the floor is reached rather than
 * always burning the full 28-query list. Never invents a lead to hit the
 * number: if real search results run out first, it reports honestly short.
 */
export async function runKvlDailyCatchup(): Promise<JobRunLog[]> {
  const resolved = await resolveRunContext();
  if ("skipLog" in resolved) return [resolved.skipLog];
  const ctx = resolved.context;

  const sentToday = await prisma.emailDraft.count({
    where: { organizationId: ctx.organizationId, campaignId: ctx.campaignId, status: "SENT", sentAt: { gte: startOfTodayIST() } },
  });

  if (sentToday >= DAILY_MIN) {
    return [{ level: "info", message: `Catch-up skipped — already sent ${sentToday}/${DAILY_MIN} today from the business-hours runs.`, organizationId: ctx.organizationId }];
  }

  const logs: JobRunLog[] = [{ level: "info", message: `Catch-up starting — only ${sentToday}/${DAILY_MIN} sent today, topping up.`, organizationId: ctx.organizationId }];
  const allFound: FoundCompany[] = [];
  let runningTotal = sentToday;

  outer: for (const sector of SECTOR_TARGETS) {
    for (const { country, query } of sector.countries) {
      if (runningTotal >= DAILY_MIN) break outer;
      const result = await processQuery(ctx, sector.label, country, query, logs);
      allFound.push(...result.found);
      runningTotal += result.found.filter((f) => f.outreach === "sent").length;
    }
  }

  const { totalSent, totalFailed } = summarize(allFound, logs, ctx.organizationId, "KVL daily catch-up");
  logs.push({
    level: runningTotal >= DAILY_MIN ? "info" : "warn",
    message: `Catch-up finished — ${runningTotal}/${DAILY_MIN} sent today${runningTotal < DAILY_MIN ? " (fell short — real search results ran out, nothing fabricated)" : ""}.`,
    organizationId: ctx.organizationId,
  });

  await logActivity({
    organizationId: ctx.organizationId,
    type: "SYSTEM_EVENT",
    description: `KVL daily catch-up: topped up from ${sentToday} to ${runningTotal}/${DAILY_MIN} sent today.`,
    actorUserId: ctx.ownerUserId,
    metadata: { sentBefore: sentToday, sentAfter: runningTotal, dailyMin: DAILY_MIN, totalFound: allFound.length, totalSent, totalFailed },
  });

  return logs;
}

/**
 * 9pm IST (registry.ts's `kvl-daily-report`) — the one daily email to the
 * owner (DIGEST_RECIPIENTS) listing every company messaged today and its
 * REAL status: sent / opened / clicked / failed, drawn straight from
 * EmailDraft's own tracking fields (populated by the real open/click pixel
 * — see tracking.ts), PLUS every real reply actually captured today by the
 * IMAP reply-sync job (kvl-reply-sync-job.ts) via logReplyCore, with its
 * real AI-classified sentiment. If KVL_IMAP_* isn't configured, that sync
 * job never runs, so this section honestly shows zero replies rather than
 * silently pretending nothing came in. Final deal-closing stays entirely
 * with the owner — this job only ever reports, never negotiates or
 * advances a deal stage on its own.
 */
export async function sendKvlDailyReport(): Promise<JobRunLog[]> {
  const organizationId = await resolveKvlOrganizationId();
  if (!organizationId) return [{ level: "warn", message: `Skipped — no active OWNER membership found for ${KVL_OWNER_EMAIL}.` }];

  const campaign = await prisma.campaign.findFirst({ where: { organizationId, name: KVL_OUTREACH_CAMPAIGN_NAME } });
  if (!campaign) return [{ level: "warn", message: "Skipped — KVL Sector Outreach campaign doesn't exist yet (no run has happened).", organizationId }];

  const todayStart = startOfTodayIST();
  const [drafts, replies] = await Promise.all([
    prisma.emailDraft.findMany({
      where: { organizationId, campaignId: campaign.id, createdAt: { gte: todayStart } },
      include: { contact: { include: { company: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.reply.findMany({
      where: { organizationId, receivedAt: { gte: todayStart }, contact: { campaigns: { some: { campaignId: campaign.id } } } },
      include: { contact: { include: { company: true } } },
      orderBy: { receivedAt: "asc" },
    }),
  ]);

  const sentDrafts = drafts.filter((d) => d.status === "SENT");
  const failedDrafts = drafts.filter((d) => d.status === "FAILED");
  const totalSent = sentDrafts.length;
  const totalOpened = sentDrafts.filter((d) => d.openCount > 0).length;
  const totalClicked = sentDrafts.filter((d) => d.clickCount > 0).length;

  const dateLabel = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const rowLabel = (d: (typeof drafts)[number]) =>
    d.status === "SENT" ? (d.clickCount > 0 ? "sent, clicked" : d.openCount > 0 ? "sent, opened" : "sent") : d.status === "FAILED" ? `failed (${d.failedReason ?? "unknown reason"})` : d.status;

  const lines = drafts.map((d) => `  - ${d.contact.company?.name ?? d.contact.email} (${d.contact.email}, ${d.contact.country ?? "unknown country"}) — ${rowLabel(d)}`);
  const replyLines = replies.map(
    (r) => `  - ${r.contact.company?.name ?? r.contact.email} (${r.contact.email})${r.sentiment ? ` [${r.sentiment}]` : ""}: "${r.content.slice(0, 300)}${r.content.length > 300 ? "…" : ""}"`,
  );

  const replySection = replies.length > 0 ? replyLines.join("\n") : imapConfigured() ? "  (no replies today)" : "  (0 — real inbox reading isn't configured yet, set KVL_IMAP_HOST/KVL_IMAP_USER/KVL_IMAP_PASSWORD)";

  const text = [
    `KVL daily outreach report — ${dateLabel}`,
    "",
    `Emails sent today: ${totalSent}/${DAILY_MIN} target (${totalOpened} opened, ${totalClicked} clicked, ${failedDrafts.length} failed)`,
    "",
    drafts.length > 0 ? lines.join("\n") : "  (no outreach attempts today)",
    "",
    `Real replies received today (${replies.length}):`,
    replySection,
    "",
    "Final deal-closing is entirely on you — nothing here negotiates or moves a deal stage automatically.",
  ].join("\n");

  const html = `
    <h2>KVL daily outreach report — ${dateLabel}</h2>
    <p><strong>Emails sent today: ${totalSent}/${DAILY_MIN} target</strong> — ${totalOpened} opened, ${totalClicked} clicked, ${failedDrafts.length} failed.</p>
    ${
      drafts.length > 0
        ? `<ul>${drafts
            .map(
              (d) =>
                `<li>${d.contact.company?.name ?? d.contact.email} (${d.contact.email}, ${d.contact.country ?? "unknown country"}) — <em>${rowLabel(d)}</em></li>`,
            )
            .join("")}</ul>`
        : "<p>(no outreach attempts today)</p>"
    }
    <h3>Real replies received today (${replies.length})</h3>
    ${
      replies.length > 0
        ? `<ul>${replies
            .map(
              (r) =>
                `<li><strong>${r.contact.company?.name ?? r.contact.email}</strong> (${r.contact.email})${r.sentiment ? ` — <em>${r.sentiment}</em>` : ""}: &ldquo;${r.content.slice(0, 300)}${r.content.length > 300 ? "…" : ""}&rdquo;</li>`,
            )
            .join("")}</ul>`
        : `<p>${imapConfigured() ? "No replies today." : "Real inbox reading isn't configured yet — set KVL_IMAP_HOST/KVL_IMAP_USER/KVL_IMAP_PASSWORD to start auto-capturing replies."}</p>`
    }
    <p>Final deal-closing is entirely on you — nothing here negotiates or moves a deal stage automatically.</p>
  `;

  for (const to of DIGEST_RECIPIENTS) {
    await sendEmail({ to, subject: `KVL daily outreach report — ${totalSent}/${DAILY_MIN} sent, ${replies.length} replies (${dateLabel})`, text, html });
  }

  return [{ level: "info", message: `Daily report sent to ${DIGEST_RECIPIENTS.join(", ")} — ${totalSent}/${DAILY_MIN} sent, ${replies.length} real replies today.`, organizationId }];
}

/** Deliberately duplicated (not imported) from kvl-reply-sync-job.ts — that file already imports FROM this one, so importing back would create a circular dependency for a one-line check. */
function imapConfigured(): boolean {
  return !!(process.env.KVL_IMAP_HOST && process.env.KVL_IMAP_USER && process.env.KVL_IMAP_PASSWORD);
}

export interface KvlOutreachSummary {
  campaignId: string;
  todaySent: number;
  todayOpened: number;
  todayClicked: number;
  todayFailed: number;
  allTimeSent: number;
  conversions: number;
  dailyTarget: number;
}

/**
 * Backs the small "KVL Sector Outreach" summary card on the org's own
 * /dashboard/outreach page (kvl-outreach-summary.tsx) — every number here is
 * a real query, nothing precomputed/cached. Returns null for any org other
 * than KVL's own (no "KVL Sector Outreach" campaign exists there), so the
 * card naturally only renders when KVL's owner is looking at KVL's own org —
 * no special-casing needed at the call site. `conversions` counts real Won
 * deals (the same `dealStage.name === "Won"` convention this codebase
 * already uses everywhere else — see src/lib/analytics.ts,
 * src/lib/pipeline/intelligence.ts) whose contact was actually enrolled in
 * this campaign, i.e. a genuine "this specific outreach led to a closed
 * deal" count, not just any Won deal in the org.
 */
export async function getKvlOutreachSummary(organizationId: string): Promise<KvlOutreachSummary | null> {
  const campaign = await prisma.campaign.findFirst({ where: { organizationId, name: KVL_OUTREACH_CAMPAIGN_NAME } });
  if (!campaign) return null;

  const [todayDrafts, allTimeSent, conversions] = await Promise.all([
    prisma.emailDraft.findMany({
      where: { organizationId, campaignId: campaign.id, createdAt: { gte: startOfTodayIST() } },
      select: { status: true, openCount: true, clickCount: true },
    }),
    prisma.emailDraft.count({ where: { organizationId, campaignId: campaign.id, status: "SENT" } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" }, contact: { campaigns: { some: { campaignId: campaign.id } } } } }),
  ]);

  const todaySentDrafts = todayDrafts.filter((d) => d.status === "SENT");

  return {
    campaignId: campaign.id,
    todaySent: todaySentDrafts.length,
    todayOpened: todaySentDrafts.filter((d) => d.openCount > 0).length,
    todayClicked: todaySentDrafts.filter((d) => d.clickCount > 0).length,
    todayFailed: todayDrafts.filter((d) => d.status === "FAILED").length,
    allTimeSent,
    conversions,
    dailyTarget: DAILY_MIN,
  };
}
