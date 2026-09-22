import { createHash } from "node:crypto";

import { createFileStore } from "./file-store";

/**
 * Phase 18 (AI Career Agent Foundation) — reuses the SAME shared FileStore
 * primitive every other document store in this app uses (createFileStore),
 * never a second storage system. A separate subdirectory ("career-resumes")
 * from the internal-ATS resumes.ts store, since these are user-owned career
 * documents, not organization-owned hiring candidates.
 */
const store = createFileStore("career-resumes");

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export const CAREER_RESUME_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export interface CareerResumeUploadResult {
  storageKey: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Real server-side validation — never trusts the client-supplied MIME type
 * alone for the extension allowlist (§21), but does use it as the initial
 * gate since a real file-signature ("magic bytes") check for every format
 * here is beyond this foundation phase's bounded scope; PDF/DOCX both fail
 * loudly at real parse time (extractResumeText) if the bytes don't actually
 * match, so a spoofed MIME type surfaces as a real FAILED processing status
 * rather than silently succeeding.
 */
export async function saveCareerResume(organizationId: string, careerResumeId: string, file: File): Promise<CareerResumeUploadResult> {
  if (file.size === 0) throw new Error("Choose a resume file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Resume must be ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.`);
  }
  const extension = ALLOWED_EXTENSION_BY_TYPE[file.type];
  if (!extension) {
    throw new Error(`Unsupported file type "${file.type || "unknown"}". Use PDF, DOCX or TXT.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const storageKey = await store.save(organizationId, careerResumeId, `resume.${extension}`, buffer);
  return { storageKey, extension, mimeType: file.type, sizeBytes: file.size, checksum };
}

export async function readCareerResume(storageKey: string): Promise<Buffer> {
  return store.read(storageKey);
}

export async function removeCareerResume(storageKey: string): Promise<void> {
  return store.remove(storageKey);
}
