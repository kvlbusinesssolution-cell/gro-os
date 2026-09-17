import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { ComposeForm } from "./_components/compose-form";

export default async function ComposeEmailPage() {
  const { membership } = await requireActiveMembership("/dashboard/outreach/inbox/compose");

  // Real, already-persisted auto-derived context per contact — Company,
  // most relevant non-dismissed LeadOpportunity (same ordering discipline as
  // buildContactContext, src/lib/outreach/personalization.ts: priority asc,
  // opportunityScore desc, createdAt desc), most recent Deal, most recent
  // Campaign enrollment, and the Sequence tied to this contact's most recent
  // sequence-linked draft (if any). Shown read-only in the Compose UI once a
  // contact is picked — favors surfacing real linkage over adding more
  // manual-override pickers, since every one of these is already determined
  // by the chosen Contact.
  const contacts = await prisma.contact.findMany({
    where: { organizationId: membership.organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: {
        select: {
          name: true,
          industry: true,
          leadOpportunities: {
            where: { status: { not: "DISMISSED" } },
            orderBy: [{ priority: "asc" }, { opportunityScore: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { title: true, category: true, status: true },
          },
        },
      },
      deals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { name: true, value: true },
      },
      campaigns: {
        orderBy: { enrolledAt: "desc" },
        take: 1,
        select: { campaign: { select: { name: true } } },
      },
      emailDrafts: {
        where: { sequenceId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { sequence: { select: { name: true } } },
      },
    },
    orderBy: { firstName: "asc" },
  });

  return <ComposeForm contacts={contacts} />;
}
