import { NextResponse } from "next/server";
import type { LearningPatternType } from "@/generated/prisma/client";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { listPatterns } from "@/lib/learning/queries";

export const GET = withApiKeyAuth("learning:read", async (request, auth) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const patternType = (url.searchParams.get("patternType") as LearningPatternType | null) ?? undefined;
  const result = await listPatterns(auth.organizationId, { patternType, cursor, limit });
  return NextResponse.json(result);
});
