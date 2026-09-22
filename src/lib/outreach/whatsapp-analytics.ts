import { prisma } from "@/lib/prisma";

/**
 * Phase 8 (WhatsApp Business Outreach) §29 — real counts only, every
 * denominator documented, `null` (rendered "NOT AVAILABLE") whenever a rate
 * would divide by zero. No estimated/fabricated numbers.
 */
export interface WhatsAppAnalytics {
  messagesSent: number;
  delivered: number;
  read: number;
  failed: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  optOuts: number;
  deliveryRate: number | null;
  readRate: number | null;
  replyRate: number | null;
  positiveReplyRate: number | null;
  failureRate: number | null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export async function getWhatsAppAnalytics(organizationId: string): Promise<WhatsAppAnalytics> {
  const [messagesSent, delivered, read, failed, replies, positiveReplies, meetings, optOuts] = await Promise.all([
    prisma.emailDraft.count({ where: { organizationId, channel: "WHATSAPP", status: { in: ["SENT", "DELIVERED", "READ"] } } }),
    prisma.emailDraft.count({ where: { organizationId, channel: "WHATSAPP", deliveredAt: { not: null } } }),
    prisma.emailDraft.count({ where: { organizationId, channel: "WHATSAPP", readAt: { not: null } } }),
    prisma.emailDraft.count({ where: { organizationId, channel: "WHATSAPP", status: "FAILED" } }),
    prisma.reply.count({ where: { organizationId, channel: "WHATSAPP" } }),
    prisma.reply.count({ where: { organizationId, channel: "WHATSAPP", sentiment: "POSITIVE" } }),
    prisma.outreachMeeting.count({ where: { organizationId, emailDraft: { channel: "WHATSAPP" } } }),
    prisma.suppressionEntry.count({ where: { organizationId, channel: "WHATSAPP" } }),
  ]);

  const totalAttempted = messagesSent + failed;

  return {
    messagesSent,
    delivered,
    read,
    failed,
    replies,
    positiveReplies,
    meetings,
    optOuts,
    deliveryRate: rate(delivered, messagesSent),
    readRate: rate(read, delivered),
    replyRate: rate(replies, messagesSent),
    positiveReplyRate: rate(positiveReplies, replies),
    failureRate: rate(failed, totalAttempted),
  };
}
