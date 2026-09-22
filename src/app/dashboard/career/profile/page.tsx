import Link from "next/link";
import { Star, ArrowLeft } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { CreateProfileForm } from "./_components/create-profile-form";

export default async function CareerProfileListPage() {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/profile");
  const organizationId = membership.organizationId;

  const profiles = await prisma.careerProfile.findMany({
    where: { userId, organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Career Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Real, isolated profiles — editing one never changes another.
          </p>
        </div>

        {profiles.length > 0 && (
          <div className="flex flex-col gap-2">
            {profiles.map((p) => (
              <Link key={p.id} href={`/dashboard/career/profile/${p.id}`}>
                <Card glass className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                      {p.currentRole && <p className="text-xs text-muted-foreground">{p.currentRole}</p>}
                    </div>
                    {p.isPrimary && (
                      <Badge variant="accent" className="flex items-center gap-1">
                        <Star className="size-3" /> Primary
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <CreateProfileForm />
      </Container>
    </main>
  );
}
