import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getLearningOverview } from "@/lib/learning/queries";

export const GET = withApiKeyAuth("learning:read", async (_request, auth) => {
  const overview = await getLearningOverview(auth.organizationId);
  return NextResponse.json(overview);
});
