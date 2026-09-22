import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getForecastPipelineRisk } from "@/lib/forecast/queries";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const risk = await getForecastPipelineRisk(auth.organizationId);
  return NextResponse.json(risk);
});
