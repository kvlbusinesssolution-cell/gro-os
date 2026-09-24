import { NextResponse } from "next/server";

import { verifySignedFileToken } from "@/lib/storage/signed-url";
import { readDocumentFile } from "@/lib/storage/documents";
import { readMarketingAssetFile } from "@/lib/storage/marketing-assets";
import { readProjectFileVersion } from "@/lib/storage/project-files";
import { readWhiteLabelAsset } from "@/lib/storage/white-label-assets";
import { readPlatformInvoiceFile } from "@/lib/storage/platform-invoices";
import { readRagDocumentFile } from "@/lib/storage/rag-documents";
import { readKnowledgeAttachment } from "@/lib/storage/knowledge-attachments";

/**
 * Public (no dashboard/portal login) download endpoint for time-limited
 * signed file links (src/lib/storage/signed-url.ts) — e.g. emailing a
 * client a platform invoice PDF without requiring a portal account. The
 * token itself is the only credential: verifySignedFileToken checks its
 * HMAC signature + expiry with no DB round-trip.
 *
 * The token's `subdir` field is NEVER used to build a filesystem path
 * directly — it's only ever a lookup key into this fixed allowlist of
 * already-existing FileStore-backed readers (one per src/lib/storage/*.ts
 * module that calls createFileStore). A tampered subdir can't reach an
 * arbitrary path anyway, since tampering breaks the HMAC signature and
 * verifySignedFileToken returns null before this allowlist is ever
 * consulted — but the allowlist stays regardless, so this route can never
 * be tricked into resolving a subdir it doesn't already know about.
 */
const SUBDIR_READERS: Record<string, (storageKey: string) => Promise<Buffer>> = {
  documents: readDocumentFile,
  "marketing-assets": readMarketingAssetFile,
  "project-files": readProjectFileVersion,
  "white-label-assets": readWhiteLabelAsset,
  "platform-invoices": readPlatformInvoiceFile,
  "rag-documents": readRagDocumentFile,
  "knowledge-attachments": readKnowledgeAttachment,
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const payload = verifySignedFileToken(token);
  if (!payload) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 410 });
  }

  const reader = SUBDIR_READERS[payload.subdir];
  if (!reader) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await reader(payload.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": payload.contentType,
        "Content-Disposition": `attachment; filename="${payload.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    console.error("[api/files/signed] failed to read file:", error);
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
