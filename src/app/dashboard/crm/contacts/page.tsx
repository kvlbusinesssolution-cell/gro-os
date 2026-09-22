import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { CrmContactForm } from "../_components/crm-contact-form";
import { ContactList } from "../_components/contact-list";
import { CsvImportButton } from "../_components/csv-import-button";
import { importContactsFile } from "../_lib/import-export";

// Phase 25 (pagination fix — this page previously did an unbounded
// findMany, confirmed a real bug by the phase audit): same pattern as
// /dashboard/companies (Phase 24).
const PAGE_SIZE = 60;

export default async function CrmContactsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { membership } = await requireActiveMembership("/dashboard/crm/contacts");
  const organizationId = membership.organizationId;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [contacts, totalContacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.contact.count({ where: { organizationId } }),
    prisma.company.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Contacts</h1>
            <p className="text-sm text-muted-foreground">
              Full contact management — name, position, business email/phone, LinkedIn, department, company, and a
              relationship score. The same Contact rows also power Outreach&rsquo;s campaign contacts.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CsvImportButton label="Import CSV/Excel" action={importContactsFile} />
            <CrmContactForm companies={companies} />
          </div>
        </div>

        <ContactList
          companies={companies}
          contacts={contacts.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            jobTitle: c.jobTitle,
            phone: c.phone,
            department: c.department,
            linkedin: c.linkedin,
            relationshipScore: c.relationshipScore,
            companyName: c.company?.name ?? null,
            companyId: c.company?.id ?? null,
          }))}
        />

        {totalContacts > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalContacts)} of {totalContacts} contacts
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/crm/contacts?page=${page - 1}`}
                aria-disabled={page <= 1}
                className={`flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-medium text-foreground transition-colors ${
                  page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-accent"
                }`}
              >
                <ChevronLeft className="size-3.5" /> Previous
              </Link>
              <Link
                href={`/dashboard/crm/contacts?page=${page + 1}`}
                aria-disabled={page * PAGE_SIZE >= totalContacts}
                className={`flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-medium text-foreground transition-colors ${
                  page * PAGE_SIZE >= totalContacts ? "pointer-events-none opacity-40" : "hover:bg-accent"
                }`}
              >
                Next <ChevronRight className="size-3.5" />
              </Link>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
}
