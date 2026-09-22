import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { listPipelineDeals } from "@/lib/forecast/queries";

export const GET = withApiKeyAuth("forecast:read", async (_request, auth) => {
  const deals = await listPipelineDeals(auth.organizationId);
  return NextResponse.json({ deals });
});
