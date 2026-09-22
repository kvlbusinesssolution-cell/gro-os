import { MessageCircle, Link2 } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getConnection } from "@/lib/integrations/connection-store";
import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/outreach/tracking";
import { WhatsAppFromNumberForm } from "./_components/whatsapp-from-number-form";
import { WhatsAppTemplatesPanel } from "./_components/whatsapp-templates-panel";

export default async function WhatsAppSettingsPage() {
  const { membership } = await requireActiveMembership("/dashboard/settings/whatsapp");
  const organizationId = membership.organizationId;

  const [connection, templates] = await Promise.all([
    getConnection(organizationId, "TWILIO"),
    prisma.whatsAppTemplate.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
  ]);
  const metadata = connection?.metadata as { whatsappFromNumber?: string } | null | undefined;
  const webhookUrl = `${getAppBaseUrl()}/api/webhooks/twilio-whatsapp/${organizationId}`;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <MessageCircle className="size-6 text-primary" /> WhatsApp Business
          </h1>
          <p className="text-sm text-muted-foreground">
            Sent and received only through your connected, officially-approved Twilio WhatsApp Business account —
            never an unofficial WhatsApp Web/QR-session automation.
          </p>
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle className="text-base">Provider connection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Twilio account:</span>
              <Badge variant={connection?.status === "CONNECTED" ? "accent" : "outline"}>{connection?.status ?? "NOT_CONNECTED"}</Badge>
              {connection?.status !== "CONNECTED" && (
                <a href="/dashboard/settings/integrations" className="text-primary hover:underline">
                  Connect Twilio →
                </a>
              )}
            </div>
            <WhatsAppFromNumberForm currentNumber={metadata?.whatsappFromNumber ?? null} connected={connection?.status === "CONNECTED"} />
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Webhook URL — paste into your Twilio WhatsApp sender&apos;s configuration:</p>
                <code className="break-all">{webhookUrl}</code>
                <p className="mt-1">Used for both inbound messages and outbound delivery/read status callbacks.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <WhatsAppTemplatesPanel templates={templates} />
      </Container>
    </main>
  );
}
