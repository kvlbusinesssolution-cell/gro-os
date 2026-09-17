import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { prisma } from "@/lib/prisma";
import { logReplyCore } from "@/app/dashboard/outreach/_lib/reply-actions";
import { applyReplyAutomation } from "@/lib/outreach/reply-automation";
import { resolveKvlOrganizationId, KVL_OWNER_EMAIL, KVL_OUTREACH_CAMPAIGN_NAME } from "./kvl-sector-discovery-job";
import type { JobRunLog } from "@/lib/scheduler/types";

/**
 * Real IMAP inbox read for KVL's own sales mailbox — the only automatic
 * reply-capture in this app (every other org still relies on the manual
 * "log a reply" form, src/app/dashboard/outreach/_lib/reply-actions.ts's
 * logReply). Hardcoded to KVL's own mailbox by design, same "one-off,
 * KVL-only" convention as kvl-sector-discovery-job.ts — this is not a
 * generic per-org email integration (that would need real OAuth/credential
 * storage UI, a much bigger feature).
 *
 * Dedup strategy: only ever fetches messages the mailbox itself has not yet
 * marked \Seen, and marks each one \Seen right after processing it
 * (success or not) — the mailbox's own read state IS the durable "have we
 * looked at this yet" record, so this is safe to run on a tight interval
 * without ever double-logging the same reply. A message from a sender we
 * don't recognize (no matching Contact) is still marked \Seen — it's
 * genuinely not a lead reply, not something to keep re-checking forever.
 */
function imapConfigured(): boolean {
  return !!(process.env.KVL_IMAP_HOST && process.env.KVL_IMAP_USER && process.env.KVL_IMAP_PASSWORD);
}

export async function runKvlReplySync(): Promise<JobRunLog[]> {
  if (!imapConfigured()) {
    return [{ level: "warn", message: "Skipped — KVL_IMAP_HOST/KVL_IMAP_USER/KVL_IMAP_PASSWORD not configured yet." }];
  }

  const organizationId = await resolveKvlOrganizationId();
  if (!organizationId) return [{ level: "warn", message: `Skipped — no active OWNER membership found for ${KVL_OWNER_EMAIL}.` }];

  const owner = await prisma.user.findUnique({ where: { email: KVL_OWNER_EMAIL }, select: { id: true } });
  if (!owner) return [{ level: "warn", message: `Skipped — no user found for ${KVL_OWNER_EMAIL}.`, organizationId }];

  const campaign = await prisma.campaign.findFirst({ where: { organizationId, name: KVL_OUTREACH_CAMPAIGN_NAME } });

  const logs: JobRunLog[] = [];
  const client = new ImapFlow({
    host: process.env.KVL_IMAP_HOST!,
    port: Number(process.env.KVL_IMAP_PORT ?? 993),
    secure: (process.env.KVL_IMAP_SECURE ?? "true") !== "false",
    auth: { user: process.env.KVL_IMAP_USER!, pass: process.env.KVL_IMAP_PASSWORD! },
    logger: false,
  });

  let loggedCount = 0;
  let unmatchedCount = 0;
  let errorCount = 0;

  try {
    await client.connect();
  } catch (error) {
    return [{ level: "error", message: `IMAP connect failed: ${error instanceof Error ? error.message : String(error)}`, organizationId }];
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) {
        return [{ level: "info", message: "No new (unseen) messages in the inbox.", organizationId }];
      }

      for (const uid of uids) {
        try {
          const message = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!message || !message.source) continue;

          const parsed = await simpleParser(message.source);
          const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase().trim();
          const bodyText = (parsed.text ?? parsed.html ?? "").toString().trim();

          if (!fromAddress || !bodyText) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          const contact = await prisma.contact.findFirst({ where: { organizationId, email: fromAddress } });
          if (!contact) {
            unmatchedCount += 1;
            logs.push({ level: "info", message: `No matching contact for reply from ${fromAddress} — marked read, not logged.`, organizationId });
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          const latestDraft = campaign
            ? await prisma.emailDraft.findFirst({ where: { contactId: contact.id, campaignId: campaign.id, status: "SENT" }, orderBy: { sentAt: "desc" } })
            : null;

          const result = await logReplyCore(organizationId, owner.id, contact.id, bodyText, "EMAIL", latestDraft?.id, parsed.date ?? undefined);
          if (result.ok) {
            loggedCount += 1;
            logs.push({ level: "info", message: `Logged real reply from ${fromAddress} (${contact.firstName}) — sentiment: ${result.sentiment ?? "unclassified"}.`, organizationId });

            // Same non-blocking discipline as the logReply wrapper — an
            // automation failure must never make a real, successfully
            // logged reply look like a failed sync.
            if (result.replyId) {
              try {
                await applyReplyAutomation(result.replyId);
              } catch (error) {
                logs.push({ level: "error", message: `applyReplyAutomation failed for reply ${result.replyId}: ${error instanceof Error ? error.message : String(error)}`, organizationId });
              }
            }
          } else {
            errorCount += 1;
            logs.push({ level: "error", message: `Failed to log reply from ${fromAddress}: ${result.error}`, organizationId });
          }

          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (error) {
          errorCount += 1;
          logs.push({ level: "error", message: `Failed processing message uid ${uid}: ${error instanceof Error ? error.message : String(error)}`, organizationId });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  logs.push({
    level: "info",
    message: `Reply sync done — ${loggedCount} real repl${loggedCount === 1 ? "y" : "ies"} logged, ${unmatchedCount} unmatched sender(s), ${errorCount} error(s).`,
    organizationId,
  });
  return logs;
}
