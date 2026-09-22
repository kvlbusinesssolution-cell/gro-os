import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readCareerResume, CAREER_RESUME_CONTENT_TYPE_BY_EXTENSION } from "@/lib/storage/career-resumes";

/**
 * Phase 18 (AI Career Agent Foundation) — real, IDOR-protected resume
 * download. Every request re-checks: signed in, then the CareerResume's
 * parent CareerProfile.userId matches the signed-in user exactly — never
 * merely "same organization" (career data is personal, not org-shared).
 * A wrong/nonexistent id and someone else's real resume both return the
 * identical 404, never a distinguishable "exists but not yours" response.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resume = await prisma.careerResume.findUnique({
    where: { id },
    include: { careerProfile: { select: { userId: true, name: true } } },
  });
  if (!resume || resume.careerProfile.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = resume.storageKey.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CAREER_RESUME_CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";

  try {
    const buffer = await readCareerResume(resume.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${resume.originalFilename.replace(/[^a-z0-9 _.-]/gi, "_")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[api/career/resumes] failed to read file:", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
