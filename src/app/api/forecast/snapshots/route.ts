import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { listForecastSnapshots } from "@/lib/forecast/queries";

/** §27 — forecast-evolution history for one entity+type: ?entityType=DEAL|ORGANIZATION&entityId=... */
export const GET = withApiKeyAuth("forecast:read", async (request, auth) => {
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if ((entityType !== "DEAL" && entityType !== "ORGANIZATION") || !entityId) {
    return NextResponse.json({ error: "entityType (DEAL|ORGANIZATION) and entityId query params are required." }, { status: 400 });
  }
  const snapshots = await listForecastSnapshots(auth.organizationId, entityType, entityId);
  return NextResponse.json({ snapshots });
});
