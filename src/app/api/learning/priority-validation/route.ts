import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { computePriorityValidation } from "@/lib/learning/priority-validation";

export const GET = withApiKeyAuth("learning:read", async (_request, auth) => {
  const result = await computePriorityValidation(auth.organizationId);
  return NextResponse.json(result ?? { sampleSize: 0, summary: "INSUFFICIENT_DATA — no opportunity observations exist yet." });
});
