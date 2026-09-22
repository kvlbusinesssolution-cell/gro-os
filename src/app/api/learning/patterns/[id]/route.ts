import { NextResponse } from "next/server";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";
import { prisma } from "@/lib/prisma";

/** id parsed from the URL path (not via Next's route params) — same convention v1/workflows/[workflowId]/trigger/route.ts uses, since withApiKeyAuth's wrapper signature doesn't forward route context. */
export const GET = withApiKeyAuth("learning:read", async (request, auth) => {
  const id = new URL(request.url).pathname.split("/").at(-1);
  if (!id) return NextResponse.json({ error: "Missing pattern id." }, { status: 400 });

  const pattern = await prisma.learningPattern.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!pattern) return NextResponse.json({ error: "Pattern not found." }, { status: 404 });
  return NextResponse.json(pattern);
});
