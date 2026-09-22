import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getPredictionSnapshotById } from "@/lib/forecast/queries";

/** id parsed from the URL path — same convention as /api/learning/patterns/[id]/route.ts. */
export const GET = withApiKeyAuth("forecast:read", async (request, auth) => {
  const id = new URL(request.url).pathname.split("/").at(-1);
  if (!id) return NextResponse.json({ error: "Missing prediction id." }, { status: 400 });

  const snapshot = await getPredictionSnapshotById(auth.organizationId, id);
  if (!snapshot) return NextResponse.json({ error: "Prediction not found." }, { status: 404 });
  return NextResponse.json(snapshot);
});
