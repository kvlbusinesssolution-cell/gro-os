import { NextResponse } from "next/server";
import type { LearningRecommendationStatus } from "@/generated/prisma/client";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { listRecommendations } from "@/lib/learning/queries";

/** Read-only — approve/reject are dashboard-session governance actions only (see src/app/dashboard/learning/recommendations/actions.ts), never API-key-triggerable (§32). */
export const GET = withApiKeyAuth("learning:read", async (request, auth) => {
  const status = (new URL(request.url).searchParams.get("status") as LearningRecommendationStatus | null) ?? undefined;
  const recommendations = await listRecommendations(auth.organizationId, { status });
  return NextResponse.json({ recommendations });
});
