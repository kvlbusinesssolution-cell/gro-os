import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { getPatternWithEvidence } from "@/lib/learning/queries";

/** §41 — the real companies/opportunities/deals/revenue behind one pattern. patternId parsed from the URL path, same convention as patterns/[id]/route.ts. */
export const GET = withApiKeyAuth("learning:read", async (request, auth) => {
  const patternId = new URL(request.url).pathname.split("/").at(-1);
  if (!patternId) return NextResponse.json({ error: "Missing pattern id." }, { status: 400 });

  const result = await getPatternWithEvidence(auth.organizationId, patternId);
  if (!result) return NextResponse.json({ error: "Pattern not found." }, { status: 404 });
  return NextResponse.json(result);
});
