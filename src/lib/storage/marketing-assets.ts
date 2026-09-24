import { createFileStore } from "./file-store";

/**
 * Local-disk storage for a landing page's gated "lead magnet" asset (a PDF
 * guide, a checklist, etc.) — same convention as documents.ts. Never served
 * from a public static path; only ever downloadable through a time-limited
 * signed URL (src/lib/storage/signed-url.ts + src/app/api/files/signed/
 * [token]/route.ts), generated fresh after a real form submission.
 */
const store = createFileStore("marketing-assets");

export async function saveMarketingAssetFile(
  organizationId: string,
  landingPageId: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  return store.save(organizationId, landingPageId, filename, buffer);
}

export async function readMarketingAssetFile(storageKey: string): Promise<Buffer> {
  return store.read(storageKey);
}

export async function deleteMarketingAssetFile(storageKey: string): Promise<void> {
  return store.remove(storageKey);
}
