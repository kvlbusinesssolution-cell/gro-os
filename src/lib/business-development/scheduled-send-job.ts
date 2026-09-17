import { prisma } from "@/lib/prisma";
import type { JobRunLog } from "@/lib/scheduler/types";
import { sendQueuedDraftCore } from "@/app/dashboard/outreach/_lib/approval-actions";

/**
 * Scheduled Email Send (Email Center Phase 3 follow-up). `EmailDraft.
 * scheduledFor` (set from Compose's "Schedule" action) previously had
 * nothing that ever promoted a due draft — a scheduled draft just sat
 * APPROVED forever. This job is that promotion, on a short (5-minute) cron
 * cadence so a "send at 3pm" schedule fires within a few minutes of the
 * real time, not whenever someone next happens to view the Outreach page.
 *
 * Finds every EmailDraft that is still APPROVED with a real `scheduledFor`
 * that has now passed, and for each one:
 *   1. Re-checks the contact isn't UNSUBSCRIBED (reply-automation.ts's
 *      UNSUBSCRIBE case is the real, existing signal that sets
 *      Contact.status = "UNSUBSCRIBED" — a contact can unsubscribe any time
 *      after a draft was scheduled but before it's due). If so, the draft is
 *      failed with a clear reason and never promoted to QUEUED — promoting
 *      it first would misleadingly suggest a send was about to happen.
 *   2. Otherwise promotes APPROVED -> QUEUED (queuedAt: now — exactly the
 *      transition the EmailDraft.scheduledFor schema comment documents),
 *      then calls sendQueuedDraftCore (approval-actions.ts) — the SAME real
 *      send path a human's "Send now" click uses. This job never
 *      re-implements send logic; sendQueuedDraftCore itself re-checks the
 *      unsubscribe status again at send time as a second, independent
 *      layer of defense (a contact could theoretically unsubscribe in the
 *      moment between this job's own check and the send call).
 *
 * `actingUserId: null` is passed to sendQueuedDraftCore because no human
 * triggered this particular send — see that function's doc comment for how
 * it notifies the org's OWNER/ADMIN roster instead of a specific user in
 * that case.
 *
 * Bounded batch per run, real per-item try/catch (one failing draft never
 * blocks the rest) — same defensive shape as every other job in
 * registry.ts's batch-processing jobs (company-research-backlog,
 * website-intelligence-sync, etc.), even though this job isn't gated behind
 * LeadDiscoveryConfig.discoveryEnabled the way those are: a scheduled send
 * is an explicit per-draft user action (Compose's own "Schedule" click), not
 * unattended AI spend/discovery, so it always runs.
 */
const MAX_DRAFTS_PER_RUN = 50;

export async function runScheduledEmailSend(): Promise<JobRunLog[]> {
  const now = new Date();

  const dueDrafts = await prisma.emailDraft.findMany({
    where: {
      status: "APPROVED",
      scheduledFor: { not: null, lte: now },
    },
    orderBy: { scheduledFor: "asc" },
    take: MAX_DRAFTS_PER_RUN,
    include: { contact: { select: { id: true, status: true } } },
  });

  const logs: JobRunLog[] = [];
  let sent = 0;
  let failed = 0;
  let skippedUnsubscribed = 0;

  for (const draft of dueDrafts) {
    try {
      if (draft.contact.status === "UNSUBSCRIBED") {
        const failedReason = "Contact unsubscribed after this draft was scheduled — send cancelled.";
        await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedReason } });
        skippedUnsubscribed += 1;
        logs.push({ level: "warn", message: `Draft ${draft.id}: ${failedReason}`, organizationId: draft.organizationId });
        continue;
      }

      await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "QUEUED", queuedAt: now } });

      const result = await sendQueuedDraftCore(draft.organizationId, draft.id, null);
      if (result.ok) {
        sent += 1;
        logs.push({ level: "info", message: `Sent scheduled draft ${draft.id}.`, organizationId: draft.organizationId });
      } else {
        failed += 1;
        logs.push({ level: "error", message: `Scheduled draft ${draft.id} failed to send: ${result.error}`, organizationId: draft.organizationId });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      logs.push({ level: "error", message: `Draft ${draft.id}: ${message}`, organizationId: draft.organizationId });
      try {
        await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedReason: message } });
      } catch {
        // Best-effort only — the error above is already logged either way.
      }
    }
  }

  logs.push({
    level: "info",
    message: `Processed ${dueDrafts.length} due scheduled draft(s): ${sent} sent, ${failed} failed, ${skippedUnsubscribed} skipped (unsubscribed).`,
  });

  return logs;
}
