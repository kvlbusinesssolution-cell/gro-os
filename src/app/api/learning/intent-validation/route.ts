import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { computeIntentValidation } from "@/lib/learning/intent-validation";

export const GET = withApiKeyAuth("learning:read", async (_request, auth) => {
  const result = await computeIntentValidation(auth.organizationId);
  return NextResponse.json(result ?? { sampleSize: 0, summary: "INSUFFICIENT_DATA — no observations with a known intent band exist yet." });
});
