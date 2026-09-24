import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../../_lib/require-membership";

export default async function LandingPageLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/marketing/landing-pages/${id}/leads`);

  const page = await prisma.marketingLandingPage.findUnique({
    where: { id },
    include: { leads: { orderBy: { createdAt: "desc" }, take: 200, include: { contact: true } } },
  });
  if (!page || page.organizationId !== membership.organizationId) notFound();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads — {page.title}</h1>
          <p className="text-sm text-muted-foreground">Real submissions from this landing page — free to receive, never Growth-Token-gated.</p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  No leads yet.
                </TableCell>
              </TableRow>
            )}
            {page.leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  {lead.contact.firstName} {lead.contact.lastName ?? ""}
                </TableCell>
                <TableCell>{lead.contact.email}</TableCell>
                <TableCell>{lead.contact.phone ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{lead.createdAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Container>
    </main>
  );
}
