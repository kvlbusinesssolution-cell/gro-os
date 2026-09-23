import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import PDFDocument from "pdfkit";
import type * as FontkitTypes from "fontkit";

import type { CVContent, CVTemplate } from "@/lib/validations/career-cv";

const MARGIN = 46;
const PAGE_SIZE = "A4";
const TEXT_COLOR = "#1a1a1a";
const MUTED_COLOR = "#5b5f57";
const ACCENT_COLOR = "#1f4b43";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts", "cv");
const REGULAR_FONT_PATH = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const BOLD_FONT_PATH = path.join(FONT_DIR, "NotoSans-Bold.ttf");

// fontkit's package.json "exports" map resolves to a browser-targeted ESM
// build (no real filesystem access) under Vite/Vitest's default ESM
// resolution — the same class of bundler-interference problem pdfkit's own
// serverExternalPackages entry in next.config.ts works around for .afm
// files. createRequire forces the real Node CJS build (dist/main.cjs),
// which genuinely has openSync, in every runtime (Vitest, Next dev, Next
// production) rather than only working by accident in one of them.
const requireNode = createRequire(import.meta.url);
const fontkit = requireNode("fontkit") as typeof FontkitTypes;

let cachedFontkitFont: FontkitTypes.Font | null = null;
function getCoverageFont(): FontkitTypes.Font {
  if (!cachedFontkitFont) {
    // The bundled file is a single-font TTF, never a .ttc/.dfont collection
    // — openSync's Font | FontCollection union only matters for those.
    cachedFontkitFont = fontkit.openSync(REGULAR_FONT_PATH) as FontkitTypes.Font;
  }
  return cachedFontkitFont;
}

/**
 * Real glyph-coverage check against the actual embedded font — never a
 * hardcoded script allowlist alone. Whitespace/control/format characters
 * (e.g. ZWJ used inside real Devanagari conjuncts) are always treated as
 * supported since they carry no visible glyph of their own. Returns the
 * distinct set of characters the font genuinely cannot render, so a caller
 * can reject with a specific, actionable message instead of silently
 * producing missing-glyph boxes in the generated PDF.
 */
export function findUnsupportedCharacters(text: string): string[] {
  if (!text) return [];
  const font = getCoverageFont();
  const unsupported = new Set<string>();
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) continue; // control chars
    if (/\s/.test(char)) continue;
    if (codePoint === 0x200d || codePoint === 0x200c) continue; // ZWJ / ZWNJ — real Indic conjunct formatters, no glyph of their own
    if (!font.hasGlyphForCodePoint(codePoint)) unsupported.add(char);
  }
  return [...unsupported];
}

/** Every user-authored string field in a CVContent, flattened for a single real coverage pass. */
export function collectCVText(content: CVContent): string {
  const parts: string[] = [content.personal.fullName, content.personal.headline, content.personal.email, content.personal.phone, content.personal.location, content.summary];
  for (const link of content.personal.links) parts.push(link.label);
  for (const exp of content.experience) parts.push(exp.company, exp.role, exp.location, exp.startDate, exp.endDate, ...exp.bullets);
  for (const edu of content.education) parts.push(edu.institution, edu.degree, edu.field, edu.startDate, edu.endDate, edu.notes);
  parts.push(...content.skills);
  for (const cert of content.certifications) parts.push(cert.name, cert.issuer, cert.date);
  for (const lang of content.languagesSpoken) parts.push(lang.name, lang.proficiency);
  for (const proj of content.projects) parts.push(proj.name, proj.description);
  return parts.filter(Boolean).join(" ");
}

function collectPdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function registerFonts(doc: PDFKit.PDFDocument): Promise<void> {
  const [regular, bold] = await Promise.all([readFile(REGULAR_FONT_PATH), readFile(BOLD_FONT_PATH)]);
  doc.registerFont("CV-Regular", regular);
  doc.registerFont("CV-Bold", bold);
}

function dateRange(startDate: string, endDate: string, current: boolean): string {
  const start = startDate.trim();
  const end = current ? "Present" : endDate.trim();
  if (!start && !end) return "";
  if (!end) return start;
  if (!start) return end;
  return `${start} – ${end}`;
}

function renderClassic(doc: PDFKit.PDFDocument, content: CVContent): void {
  const usableWidth = doc.page.width - MARGIN * 2;

  doc.font("CV-Bold").fontSize(22).fillColor(TEXT_COLOR).text(content.personal.fullName, MARGIN, MARGIN);
  if (content.personal.headline) {
    doc.font("CV-Regular").fontSize(12).fillColor(ACCENT_COLOR).text(content.personal.headline);
  }
  const contactLine = [content.personal.email, content.personal.phone, content.personal.location].filter(Boolean).join("   •   ");
  if (contactLine) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(contactLine);
  const links = content.personal.links.map((l) => `${l.label}: ${l.url}`).join("   •   ");
  if (links) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(links);

  doc.moveDown(0.6);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + usableWidth, doc.y).strokeColor("#d8d4c6").lineWidth(1).stroke();
  doc.moveDown(0.8);

  function heading(text: string) {
    doc.font("CV-Bold").fontSize(12.5).fillColor(ACCENT_COLOR).text(text.toUpperCase());
    doc.moveDown(0.3);
  }

  if (content.summary) {
    heading("Summary");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.summary, { lineGap: 2 });
    doc.moveDown(0.8);
  }

  if (content.experience.length > 0) {
    heading("Experience");
    for (const exp of content.experience) {
      doc.font("CV-Bold").fontSize(11).fillColor(TEXT_COLOR).text(`${exp.role} — ${exp.company}`, { continued: false });
      const meta = [exp.location, dateRange(exp.startDate, exp.endDate, exp.current)].filter(Boolean).join("   •   ");
      if (meta) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(meta);
      for (const bullet of exp.bullets) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(`•  ${bullet}`, { indent: 8, lineGap: 1.5 });
      doc.moveDown(0.6);
    }
  }

  if (content.education.length > 0) {
    heading("Education");
    for (const edu of content.education) {
      const title = [edu.degree, edu.field].filter(Boolean).join(", ");
      doc.font("CV-Bold").fontSize(11).fillColor(TEXT_COLOR).text(title ? `${title} — ${edu.institution}` : edu.institution);
      const meta = dateRange(edu.startDate, edu.endDate, false);
      if (meta) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(meta);
      if (edu.notes) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(edu.notes);
      doc.moveDown(0.5);
    }
  }

  if (content.skills.length > 0) {
    heading("Skills");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.skills.join("   •   "));
    doc.moveDown(0.8);
  }

  if (content.certifications.length > 0) {
    heading("Certifications");
    for (const cert of content.certifications) {
      const line = [cert.name, cert.issuer, cert.date].filter(Boolean).join("   —   ");
      doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(line);
    }
    doc.moveDown(0.8);
  }

  if (content.projects.length > 0) {
    heading("Projects");
    for (const proj of content.projects) {
      doc.font("CV-Bold").fontSize(10.5).fillColor(TEXT_COLOR).text(proj.name);
      if (proj.description) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(proj.description);
      doc.moveDown(0.4);
    }
  }

  if (content.languagesSpoken.length > 0) {
    heading("Languages");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.languagesSpoken.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join("   •   "));
  }
}

const SIDEBAR_WIDTH = 175;

function renderModern(doc: PDFKit.PDFDocument, content: CVContent): void {
  // Repainted on every auto-paginated page, not just the first — sidebar
  // text (white/light colors, hardcoded throughout below) would otherwise
  // render invisibly on page 2+'s default white background once content
  // overflows a single page. `doc` is a fresh instance per renderCVToPdf()
  // call, so this listener never leaks across CVs/templates.
  function paintSidebar() {
    doc.rect(0, 0, SIDEBAR_WIDTH, doc.page.height).fill("#1f4b43");
  }
  paintSidebar();
  doc.on("pageAdded", paintSidebar);

  const sideX = 24;
  const sideWidth = SIDEBAR_WIDTH - 48;
  let sy = MARGIN;

  doc.font("CV-Bold").fontSize(17).fillColor("#ffffff").text(content.personal.fullName, sideX, sy, { width: sideWidth });
  sy = doc.y + 6;
  if (content.personal.headline) {
    doc.font("CV-Regular").fontSize(10).fillColor("#cfe3dd").text(content.personal.headline, sideX, sy, { width: sideWidth });
    sy = doc.y + 12;
  }

  function sideHeading(text: string) {
    doc.font("CV-Bold").fontSize(9.5).fillColor("#a9d6c8").text(text.toUpperCase(), sideX, doc.y, { width: sideWidth });
    doc.moveDown(0.3);
  }

  doc.y = sy;
  sideHeading("Contact");
  for (const line of [content.personal.email, content.personal.phone, content.personal.location]) {
    if (line) doc.font("CV-Regular").fontSize(9).fillColor("#ffffff").text(line, sideX, doc.y, { width: sideWidth });
  }
  for (const link of content.personal.links) {
    doc.font("CV-Regular").fontSize(9).fillColor("#ffffff").text(`${link.label}: ${link.url}`, sideX, doc.y, { width: sideWidth });
  }
  doc.moveDown(0.8);

  if (content.skills.length > 0) {
    sideHeading("Skills");
    doc.font("CV-Regular").fontSize(9).fillColor("#ffffff").text(content.skills.join(", "), sideX, doc.y, { width: sideWidth, lineGap: 2 });
    doc.moveDown(0.8);
  }

  if (content.languagesSpoken.length > 0) {
    sideHeading("Languages");
    for (const lang of content.languagesSpoken) {
      doc.font("CV-Regular").fontSize(9).fillColor("#ffffff").text(lang.proficiency ? `${lang.name} — ${lang.proficiency}` : lang.name, sideX, doc.y, { width: sideWidth });
    }
    doc.moveDown(0.8);
  }

  if (content.certifications.length > 0) {
    sideHeading("Certifications");
    for (const cert of content.certifications) {
      doc.font("CV-Regular").fontSize(9).fillColor("#ffffff").text([cert.name, cert.date].filter(Boolean).join(" — "), sideX, doc.y, { width: sideWidth });
    }
  }

  const mainX = SIDEBAR_WIDTH + MARGIN;
  const mainWidth = doc.page.width - mainX - MARGIN;
  doc.x = mainX;
  doc.y = MARGIN;

  function mainHeading(text: string) {
    doc.font("CV-Bold").fontSize(12.5).fillColor(ACCENT_COLOR).text(text.toUpperCase(), mainX, doc.y, { width: mainWidth });
    doc.moveDown(0.3);
  }

  if (content.summary) {
    mainHeading("Summary");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.summary, mainX, doc.y, { width: mainWidth, lineGap: 2 });
    doc.moveDown(0.8);
  }

  if (content.experience.length > 0) {
    mainHeading("Experience");
    for (const exp of content.experience) {
      doc.font("CV-Bold").fontSize(11).fillColor(TEXT_COLOR).text(`${exp.role} — ${exp.company}`, mainX, doc.y, { width: mainWidth });
      const meta = [exp.location, dateRange(exp.startDate, exp.endDate, exp.current)].filter(Boolean).join("   •   ");
      if (meta) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(meta, mainX, doc.y, { width: mainWidth });
      for (const bullet of exp.bullets) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(`•  ${bullet}`, mainX + 8, doc.y, { width: mainWidth - 8, lineGap: 1.5 });
      doc.moveDown(0.6);
    }
  }

  if (content.education.length > 0) {
    mainHeading("Education");
    for (const edu of content.education) {
      const title = [edu.degree, edu.field].filter(Boolean).join(", ");
      doc.font("CV-Bold").fontSize(11).fillColor(TEXT_COLOR).text(title ? `${title} — ${edu.institution}` : edu.institution, mainX, doc.y, { width: mainWidth });
      const meta = dateRange(edu.startDate, edu.endDate, false);
      if (meta) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(meta, mainX, doc.y, { width: mainWidth });
      doc.moveDown(0.5);
    }
  }

  if (content.projects.length > 0) {
    mainHeading("Projects");
    for (const proj of content.projects) {
      doc.font("CV-Bold").fontSize(10.5).fillColor(TEXT_COLOR).text(proj.name, mainX, doc.y, { width: mainWidth });
      if (proj.description) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(proj.description, mainX, doc.y, { width: mainWidth });
      doc.moveDown(0.4);
    }
  }
}

function renderMinimal(doc: PDFKit.PDFDocument, content: CVContent): void {
  const usableWidth = doc.page.width - MARGIN * 2;

  doc.font("CV-Regular").fontSize(24).fillColor(TEXT_COLOR).text(content.personal.fullName, MARGIN, MARGIN + 10);
  if (content.personal.headline) doc.font("CV-Regular").fontSize(11).fillColor(MUTED_COLOR).text(content.personal.headline);
  const contactLine = [content.personal.email, content.personal.phone, content.personal.location, ...content.personal.links.map((l) => l.url)].filter(Boolean).join("    ");
  if (contactLine) doc.font("CV-Regular").fontSize(9).fillColor(MUTED_COLOR).text(contactLine);
  doc.moveDown(1.2);

  function heading(text: string) {
    doc.font("CV-Regular").fontSize(10).fillColor(ACCENT_COLOR).text(text.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + usableWidth, doc.y + 2).strokeColor("#e2ddd0").lineWidth(0.75).stroke();
    doc.moveDown(0.6);
  }

  if (content.summary) {
    heading("Summary");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.summary, { lineGap: 3 });
    doc.moveDown(1);
  }

  if (content.experience.length > 0) {
    heading("Experience");
    for (const exp of content.experience) {
      doc.font("CV-Bold").fontSize(10.5).fillColor(TEXT_COLOR).text(exp.role, { continued: true }).font("CV-Regular").fillColor(MUTED_COLOR).text(`   ${exp.company}`);
      const meta = dateRange(exp.startDate, exp.endDate, exp.current);
      if (meta) doc.font("CV-Regular").fontSize(9).fillColor(MUTED_COLOR).text(meta);
      for (const bullet of exp.bullets) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(bullet, { indent: 10, lineGap: 2 });
      doc.moveDown(0.8);
    }
  }

  if (content.education.length > 0) {
    heading("Education");
    for (const edu of content.education) {
      const title = [edu.degree, edu.field].filter(Boolean).join(", ");
      doc.font("CV-Bold").fontSize(10.5).fillColor(TEXT_COLOR).text(title || edu.institution);
      if (title) doc.font("CV-Regular").fontSize(9.5).fillColor(MUTED_COLOR).text(edu.institution);
      doc.moveDown(0.6);
    }
  }

  if (content.skills.length > 0) {
    heading("Skills");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.skills.join(" · "));
    doc.moveDown(1);
  }

  if (content.projects.length > 0) {
    heading("Projects");
    for (const proj of content.projects) {
      doc.font("CV-Bold").fontSize(10.5).fillColor(TEXT_COLOR).text(proj.name);
      if (proj.description) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text(proj.description);
      doc.moveDown(0.6);
    }
  }

  if (content.certifications.length > 0) {
    heading("Certifications");
    for (const cert of content.certifications) doc.font("CV-Regular").fontSize(10).fillColor(TEXT_COLOR).text([cert.name, cert.issuer, cert.date].filter(Boolean).join(" — "));
    doc.moveDown(1);
  }

  if (content.languagesSpoken.length > 0) {
    heading("Languages");
    doc.font("CV-Regular").fontSize(10.5).fillColor(TEXT_COLOR).text(content.languagesSpoken.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join(" · "));
  }
}

const RENDERERS: Record<CVTemplate, (doc: PDFKit.PDFDocument, content: CVContent) => void> = {
  CLASSIC: renderClassic,
  MODERN: renderModern,
  MINIMAL: renderMinimal,
};

/**
 * Renders a CVContent to a real PDF buffer using the requested template.
 * Every template uses the SAME embedded Unicode font (never falls back to
 * pdfkit's standard Helvetica/Times, which cannot render Cyrillic/Greek/
 * Devanagari at all) so a document stays visually consistent regardless of
 * language. Callers must run findUnsupportedCharacters() first — this
 * function does not re-validate, so it will silently drop unsupported
 * glyphs if called directly with unchecked content.
 */
export async function renderCVToPdf(content: CVContent, templateKey: CVTemplate): Promise<Buffer> {
  const doc = new PDFDocument({ size: PAGE_SIZE, margin: MARGIN, bufferPages: true });
  const bufferPromise = collectPdfBuffer(doc);
  await registerFonts(doc);

  RENDERERS[templateKey](doc, content);

  doc.end();
  return bufferPromise;
}
