import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";

const TYPE_LABEL: Record<string, string> = {
  CALL_CLICK: "Call click",
  WHATSAPP_CLICK: "WhatsApp click",
  ENQUIRY_FORM: "Enquiry form",
};

export default async function ListingLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/leads`);

  const listing = await prisma.businessListing.findUnique({ where: { id }, include: { leads: { orderBy: { createdAt: "desc" }, take: 200 } } });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads — {listing.businessName}</h1>
          <p className="text-sm text-muted-foreground">
            Real inbound leads captured from your public listing page — free to receive in v1, never Growth-Token-gated.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listing.leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No leads yet.
                </TableCell>
              </TableRow>
            )}
            {listing.leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABEL[lead.type] ?? lead.type}</Badge>
                </TableCell>
                <TableCell>{lead.name ?? "—"}</TableCell>
                <TableCell>{lead.phone ?? lead.email ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{lead.message ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{lead.createdAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Container>
    </main>
  );
}
