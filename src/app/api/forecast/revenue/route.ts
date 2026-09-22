import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { computeMonthlyForecast } from "@/lib/forecast/revenue-forecast";

/** Current-month revenue forecast — actual + expected future + recurring, clearly separated (§12). */
export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const forecast = await computeMonthlyForecast(auth.organizationId, 0);
  return NextResponse.json(forecast);
});
