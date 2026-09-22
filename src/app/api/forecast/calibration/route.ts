import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getLatestForecastCalibration } from "@/lib/forecast/calibration";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const calibration = await getLatestForecastCalibration(auth.organizationId);
  return NextResponse.json(calibration ?? { verdict: "INSUFFICIENT_DATA", summary: "No calibration has been computed yet." });
});
