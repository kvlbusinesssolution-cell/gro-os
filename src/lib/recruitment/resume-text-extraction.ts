/**
 * Real resume text extraction — PDF via pdf-parse, DOCX via mammoth, same
 * real libraries (and same extraction calls) already used by the RAG
 * ingestion pipeline (src/lib/rag/ingestion.ts's extractPdf/extractDocx),
 * kept as a small dedicated copy here rather than importing that module so
 * recruitment stays decoupled from the RAG subsystem's own conventions.
 * Feeds analyzeCandidateResume (src/lib/recruitment/resume-analysis.ts)
 * real extracted text instead of requiring a human to paste it manually.
 */

export async function extractResumeText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Phase 18 (AI Career Agent Foundation) — real, trivial TXT support
  // (no parsing library needed, just real UTF-8 decoding). Legacy binary
  // .doc (application/msword) is deliberately NOT supported here — it needs
  // a real binary-format parser this app doesn't have; callers should show
  // an honest "not supported, please use PDF/DOCX/TXT" error rather than
  // this function silently mis-decoding it as text.
  if (mimeType === "text/plain") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported resume file type "${mimeType}". Use PDF, DOCX or TXT.`);
}
