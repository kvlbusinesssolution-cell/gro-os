import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { computePredictedPipeline } from "@/lib/forecast/pipeline";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const pipeline = await computePredictedPipeline(auth.organizationId);
  return NextResponse.json(pipeline);
});
