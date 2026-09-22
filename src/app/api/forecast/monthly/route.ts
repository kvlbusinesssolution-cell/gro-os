import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { computeMonthlyForecast } from "@/lib/forecast/revenue-forecast";

export const GET = withApiKeyAuth("forecast:read", async (request, auth) => {
  const offsetParam = new URL(request.url).searchParams.get("offset");
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
  const forecast = await computeMonthlyForecast(auth.organizationId, Number.isFinite(offset) ? offset : 0);
  return NextResponse.json(forecast);
});
