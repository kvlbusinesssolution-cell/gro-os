import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getForecastOverview } from "@/lib/forecast/queries";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const overview = await getForecastOverview(auth.organizationId);
  return NextResponse.json(overview);
});
