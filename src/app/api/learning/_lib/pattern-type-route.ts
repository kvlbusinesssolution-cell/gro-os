import { NextResponse } from "next/server";
import type { LearningPatternType } from "@/generated/prisma/client";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { listPatterns } from "@/lib/learning/queries";

/** Shared handler factory for the §21/§22/§20/§25 "one pattern type per read endpoint" routes (signals/message-angles/services/channels) — all the same paginated listPatterns query, just pre-filtered to one LearningPatternType. */
export function makePatternTypeRoute(patternType: LearningPatternType) {
  return withApiKeyAuth("learning:read", async (request, auth) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const result = await listPatterns(auth.organizationId, { patternType, cursor, limit });
    return NextResponse.json(result);
  });
}
