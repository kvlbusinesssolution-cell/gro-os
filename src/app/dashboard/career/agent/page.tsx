import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { AgentChat } from "./_components/agent-chat";

export default async function CareerAgentPage() {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/agent");

  const profiles = await prisma.careerProfile.findMany({
    where: { userId, organizationId: membership.organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Career Agent</h1>
          <p className="text-sm text-muted-foreground">
            Foundation-level only — answers grounded in your real stored profile data. Job discovery,
            applications and interviews aren&apos;t built yet, so the agent won&apos;t invent any.
          </p>
        </div>

        {profiles.length === 0 ? (
          <Card glass>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Create a career profile first.{" "}
              <Link href="/dashboard/career/profile" className="text-primary hover:underline">
                Create one
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          <AgentChat profiles={profiles} />
        )}
      </Container>
    </main>
  );
}
