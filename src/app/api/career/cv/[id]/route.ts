import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCVPdfBuffer } from "@/lib/career/cv-builder";

/**
 * Phase 35 — real, IDOR-protected CV PDF download. Same discipline as
 * /api/career/resumes/[id]: every request re-checks the owning
 * CareerProfile.userId against the signed-in user exactly, and a wrong or
 * nonexistent id both return the identical 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cv = await prisma.careerCV.findUnique({
    where: { id },
    include: { careerProfile: { select: { userId: true } } },
  });
  if (!cv || cv.careerProfile.userId !== userId || !cv.storageKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await getCVPdfBuffer(cv.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${cv.title.replace(/[^a-z0-9 _.-]/gi, "_")}.pdf"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[api/career/cv] failed to read file:", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
