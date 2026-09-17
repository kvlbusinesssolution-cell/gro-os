import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { ComposeForm } from "./_components/compose-form";

export default async function ComposeEmailPage() {
  const { membership } = await requireActiveMembership("/dashboard/outreach/inbox/compose");

  const contacts = await prisma.contact.findMany({
    where: { organizationId: membership.organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: { select: { name: true } },
    },
    orderBy: { firstName: "asc" },
  });

  return <ComposeForm contacts={contacts} />;
}
