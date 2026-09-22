import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getForecastAccuracyOverview } from "@/lib/forecast/queries";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const accuracy = await getForecastAccuracyOverview(auth.organizationId);
  return NextResponse.json(accuracy);
});
