import { KeyRound } from "lucide-react";
import Link from "next/link";

import { Container } from "@/components/ui/container";
import { requireActiveMembership } from "../../_lib/require-membership";
import { UsageDashboard } from "./_components/usage-dashboard";
import { ApiDocsSection } from "./_components/api-docs-section";
import { EventWebhookManager } from "./_components/event-webhook-manager";

export default async function ApiManagerPage() {
  const { membership } = await requireActiveMembership("/dashboard/settings/api-manager");

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <KeyRound className="size-5" /> API Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Real per-key usage, call volume over time, and the live reference for every endpoint your organization&apos;s
            API keys can call. Manage keys and their scopes from{" "}
            <Link href="/profile" className="font-medium text-primary hover:underline">
              your profile
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <UsageDashboard organizationId={membership.organizationId} />
        <EventWebhookManager />
        <ApiDocsSection />
      </div>
    </Container>
  );
}
