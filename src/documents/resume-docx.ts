import { Document, Packer, Paragraph, TextRun, BorderStyle, TabStopType } from "docx";
import type { ResumeData } from "@/lib/resume-types";
import {
  orderedEnabledSections,
  sectionLabel,
  type ResumeTemplateConfig,
  type ResumeSectionId,
} from "@/lib/resume-template";

/**
 * Resume DOCX — the ATS-friendly export: single column, no images or tables (ATS
 * parsers choke on both), plain heading + bullet structure. Renders ResumeData through
 * the founder's template so section order, headings, accent colour and font match the
 * PDF. The photo is intentionally PDF-only; the DOCX is the machine-readable version.
 */

// Word-friendly font names for the three template fonts.
const FONT_MAP: Record<ResumeTemplateConfig["style"]["font"], string> = {
  Helvetica: "Arial",
  "Times-Roman": "Times New Roman",
  Courier: "Courier New",
};

// Page geometry (twips). 1 inch = 1440 twips; we use 0.75in margins.
const MARGIN = 1080;
const PAGE = {
  A4: { width: 11906, height: 16838 },
  LETTER: { width: 12240, height: 15840 },
};

const noHash = (hex: string) => hex.replace(/^#/, "");

function dateRange(start: string, end: string, current: boolean): string {
  const e = current ? "present" : end;
  return [start, e].filter(Boolean).join(" – ");
}

function place(city: string, country: string): string {
  const loc = [city, country].filter(Boolean).join(", ");
  return loc ? `, ${loc}` : "";
}

export async function renderResumeDocx(
  data: ResumeData,
  cfg: ResumeTemplateConfig,
  language: string,
): Promise<Buffer> {
  const font = FONT_MAP[cfg.style.font];
  const accent = noHash(cfg.style.accentColor);
  const page = PAGE[cfg.style.pageSize];
  const rightTab = page.width - MARGIN * 2;

  const heading = (text: string): Paragraph =>
    new Paragraph({
      spacing: { before: 220, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 2 } },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, color: accent, size: 22, font })],
    });

  const bullet = (text: string): Paragraph =>
    new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text, size: 20, font })] });

  const para = (text: string): Paragraph =>
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text, size: 20, font })] });

  const inline = (text: string): Paragraph =>
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text, size: 20, font })] });

  const children: Paragraph[] = [];
  const h = data.header;

  // ── header ──
  children.push(
    new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: h.fullName || "Your Name", bold: true, color: accent, size: 44, font })],
    }),
  );
  if (cfg.style.showHeadline && h.headline) {
    children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: h.headline, size: 24, color: "3A465C", font })] }));
  }
  const line1 = [h.email, h.phone, h.location].filter(Boolean).join("   ·   ");
  const line2 = [
    cfg.style.showDob && h.dob ? `Born ${h.dob}` : "",
    h.nationality,
    h.relocation,
    h.linkedin,
    h.website,
  ]
    .filter(Boolean)
    .join("   ·   ");
  if (line1) children.push(new Paragraph({ children: [new TextRun({ text: line1, size: 18, color: "4A566E", font })] }));
  if (line2) children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: line2, size: 18, color: "4A566E", font })] }));

  const push = (id: ResumeSectionId, label: string) => {
    switch (id) {
      case "highlights":
        if (!data.highlights.some(Boolean)) return;
        children.push(heading(label));
        data.highlights.filter(Boolean).forEach((b) => children.push(bullet(b)));
        break;
      case "summary":
        if (!data.summary.trim()) return;
        children.push(heading(label), para(data.summary));
        break;
      case "experience":
        if (!data.experience.length) return;
        children.push(heading(label));
        for (const e of data.experience) {
          children.push(
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
              spacing: { before: 80 },
              children: [
                new TextRun({ text: `${e.company}${place(e.city, e.country)}`, bold: true, size: 21, font }),
                new TextRun({ text: `\t${dateRange(e.start, e.end, e.current)}`, size: 18, color: "636F85", font }),
              ],
            }),
          );
          if (e.position) children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: e.position, italics: true, size: 19, color: "3A465C", font })] }));
          e.bullets.filter(Boolean).forEach((b) => children.push(bullet(b)));
        }
        break;
      case "education":
        if (!data.education.length) return;
        children.push(heading(label));
        for (const e of data.education) {
          children.push(
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
              spacing: { before: 80 },
              children: [
                new TextRun({ text: `${e.institution}${place(e.city, e.country)}`, bold: true, size: 21, font }),
                new TextRun({ text: `\t${dateRange(e.start, e.end, false)}`, size: 18, color: "636F85", font }),
              ],
            }),
          );
          const sub = [e.program, e.note].filter(Boolean).join(" — ");
          if (sub) children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: sub, size: 19, color: "3A465C", font })] }));
        }
        break;
      case "certifications":
        if (!data.certifications.length) return;
        children.push(heading(label));
        data.certifications.forEach((c) => children.push(bullet([c.name, c.issuer, c.date].filter(Boolean).join(", "))));
        break;
      case "languages":
        if (!data.languages.some((l) => l.name)) return;
        children.push(heading(label), inline(data.languages.filter((l) => l.name).map((l) => `${l.name}${l.level ? ` (${l.level})` : ""}`).join("   ·   ")));
        break;
      case "computer":
        if (!data.computerSkills.some((c) => c.name)) return;
        children.push(heading(label), inline(data.computerSkills.filter((c) => c.name).map((c) => `${c.name} — ${c.level}`).join("   ·   ")));
        break;
      case "personal":
        if (!data.personalSkills.some(Boolean)) return;
        children.push(heading(label), inline(data.personalSkills.filter(Boolean).join("   ·   ")));
        break;
      case "hobbies":
        if (!data.hobbies.some(Boolean)) return;
        children.push(heading(label), inline(data.hobbies.filter(Boolean).join("   ·   ")));
        break;
    }
  };

  for (const sec of orderedEnabledSections(cfg)) push(sec.id, sectionLabel(sec, language));

  const doc = new Document({
    creator: "B2 Consultants",
    title: h.fullName ? `${h.fullName} — CV` : "CV",
    styles: { default: { document: { run: { font, size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
