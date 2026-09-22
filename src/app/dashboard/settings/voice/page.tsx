import { Phone } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getConnection } from "@/lib/integrations/connection-store";
import { getVoiceAnalytics } from "@/lib/outreach/voice-analytics";
import { VoiceFromNumberForm, AiDisclosureScriptForm } from "./_components/voice-config-form";

export default async function VoiceSettingsPage() {
  const { membership } = await requireActiveMembership("/dashboard/settings/voice");
  const organizationId = membership.organizationId;

  const [connection, analytics] = await Promise.all([getConnection(organizationId, "TWILIO"), getVoiceAnalytics(organizationId)]);
  const metadata = connection?.metadata as { voiceFromNumber?: string; aiDisclosureScript?: string } | null | undefined;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Phone className="size-6 text-primary" /> AI Voice Sales Engine
          </h1>
          <p className="text-sm text-muted-foreground">
            Real outbound calls only through your connected Twilio account, only to contacts with real, positive,
            explicitly-captured consent on file — never inferred from a phone number, never sent without the
            configured AI-disclosure statement.
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
            </div>
            <VoiceFromNumberForm currentValue={metadata?.voiceFromNumber ?? null} />
            <AiDisclosureScriptForm currentValue={metadata?.aiDisclosureScript ?? null} />
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="text-base">Real voice activity</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-0 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Calls placed</p>
              <p className="text-xl font-semibold text-foreground">{analytics.callsPlaced}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Answered</p>
              <p className="text-xl font-semibold text-foreground">{analytics.answered}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Blocked (not eligible)</p>
              <p className="text-xl font-semibold text-foreground">{analytics.blockedByEligibility}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Answer rate</p>
              <p className="text-xl font-semibold text-foreground">{analytics.answerRate === null ? "NOT AVAILABLE" : `${Math.round(analytics.answerRate * 100)}%`}</p>
            </div>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
