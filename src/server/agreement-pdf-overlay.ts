import "server-only";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CertificateDocument, type CertificateData } from "@/documents/pdf-certificate";
import { shortHash } from "@/lib/agreement";
import { winAnsiLine } from "@/lib/win-ansi";
import { isInkField, type DocField, type DocOptions } from "@/lib/agreement-doc";
import { inkOf, type FilledField } from "@/lib/agreement-fill";

/**
 * Stamping an UPLOADED PDF - template version "upload-pdf-v1".
 *
 * The founder exported this document from Word, so its layout is the one thing we must not touch.
 * Nothing is re-typeset: `pdf-lib` opens the stored bytes, draws the filled fields at the
 * coordinates somebody placed them on, adds the page chrome, and appends the certificate.
 *
 * ── WHY TWO PDF ENGINES ─────────────────────────────────────────────────────────────────────
 * They do different jobs and neither does both. `pdf-lib` can write into an existing document but
 * cannot lay out a paragraph - no wrapping, no line breaking, no flow. `@react-pdf/renderer` can
 * typeset a page but cannot open somebody else's PDF. So the certificate is typeset by react-pdf
 * (the same component the DOCX renderer uses - one certificate layout in the codebase) and merged
 * in here with `copyPages`.
 *
 * ── COORDINATES ─────────────────────────────────────────────────────────────────────────────
 * Fields are stored as fractions of the page, measured from the TOP-left, because that is how the
 * designer in the browser measures. PDF's own origin is the BOTTOM-left. `rectFor` is the only
 * place that conversion happens; if a box ever lands mirrored vertically, it is this function and
 * nothing else.
 *
 * ── WHAT IS DRAWN ON A DRAFT ────────────────────────────────────────────────────────────────
 * Every unsigned field gets a visible outline and its caption, plus an UNSIGNED watermark. The
 * student has to be able to see which boxes are theirs before they sign, and nobody must ever
 * mistake a preview for an executed contract.
 */

const CHROME_GREY = rgb(0.38, 0.42, 0.47);
const ZONE_LINE = rgb(0.52, 0.6, 0.69);
const ZONE_FILL = rgb(0.957, 0.969, 0.984);
const WATERMARK = rgb(0.9, 0.93, 0.96);

export type OverlayInput = {
  /** The stored upload. Never mutated - pdf-lib works on its own parse of these bytes. */
  source: Uint8Array;
  documentNo: string;
  dataSha256: string;
  templateVersion: string;
  title: string;
  studentName: string;
  filled: Map<string, FilledField>;
  /** Per-document switches - `initialEveryPage` is the one this stamper reads. */
  options?: DocOptions | null;
  signedAt?: Date | null;
  certificate?: CertificateData | null;
};

/** Normalised, top-left box → PDF points, bottom-left. The one conversion in the feature. */
function rectFor(field: DocField, page: PDFPage) {
  const { width, height } = page.getSize();
  const w = (field.w ?? 0) * width;
  const h = (field.h ?? 0) * height;
  return {
    x: (field.x ?? 0) * width,
    y: height - (field.y ?? 0) * height - h,
    width: w,
    height: h,
  };
}

export async function stampAgreementPdf(input: OverlayInput): Promise<Buffer> {
  const doc = await PDFDocument.load(input.source, { updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const executed = !!input.signedAt;

  // ── Fields ──
  for (const filled of input.filled.values()) {
    const { field } = filled;
    if (!field.page || field.x === undefined || field.y === undefined || field.w === undefined || field.h === undefined) {
      continue; // unplaced: `validateDocBody` refuses to issue, and a preview just omits it
    }
    const page = pages[field.page - 1];
    if (!page) continue; // a field left behind on a page a re-upload removed
    const rect = rectFor(field, page);

    if (isInkField(field.kind)) {
      if (filled.ink) {
        await drawInk(doc, page, rect, filled.ink);
        continue;
      }
      drawEmptyZone(page, rect, filled.caption, helvBold);
      continue;
    }

    if (field.kind === "CHECKBOX") {
      // Drawn as vectors, never as the character "\u2713": pdf-lib THROWS on a glyph WinAnsi
      // cannot encode, so a typed tick would fail the whole stamp rather than look wrong.
      drawTickBox(page, rect, filled.ticked);
      continue;
    }

    if (filled.text) {
      drawFieldText(page, rect, filled.text, helv);
    } else {
      drawEmptyZone(page, rect, filled.caption, helvBold);
    }
  }

  // ── Initials in the footer of every page, when the document asks for it ──
  //
  // The guided clause sets have always initialled every page; an uploaded PDF could not, because
  // the overlay only touches boxes somebody placed. Only on a signed copy: an unsigned preview
  // has no ink to stamp, and a page footer that LOOKS initialled would be the one thing on this
  // document that lies.
  if (input.options?.initialEveryPage && executed) {
    const marks = [inkOf(input.filled, "CREATOR"), inkOf(input.filled, "STUDENT")].filter(
      (m): m is string => !!m,
    );
    if (marks.length > 0) {
      for (const page of pages) {
        const { width } = page.getSize();
        let x = width / 2 - 24 * marks.length;
        for (const mark of marks) {
          await drawInk(doc, page, { x, y: 10, width: 44, height: 18 }, mark);
          x += 48;
        }
      }
    }
  }

  // ── Page chrome: the document number and the content hash, on every page ──
  const head = winAnsiLine(
    `${input.documentNo} · Content hash ${shortHash(input.dataSha256)}`,
  );
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    page.drawText(head, { x: 24, y: 14, size: 6.5, font: helv, color: CHROME_GREY });
    const label = winAnsiLine(`Page ${i + 1} of ${pages.length}`);
    page.drawText(label, {
      x: width - 24 - helv.widthOfTextAtSize(label, 6.5),
      y: 14,
      size: 6.5,
      font: helv,
      color: CHROME_GREY,
    });
    if (!executed) {
      drawWatermark(page, helvBold);
    }
  });

  // ── Certificate, on sealed copies only ──
  if (input.certificate && executed) {
    // `createElement` rather than calling the component: react-pdf renders the component itself,
    // the way it does for every other document in this codebase.
    const certBytes = await renderToBuffer(
      createElement(CertificateDocument, {
        documentNo: input.documentNo,
        title: input.title,
        dataSha256: input.dataSha256,
        templateVersion: input.templateVersion,
        studentName: input.studentName,
        signedAt: input.signedAt!,
        certificate: input.certificate,
      }),
    );
    const cert = await PDFDocument.load(certBytes);
    const copied = await doc.copyPages(cert, cert.getPageIndices());
    for (const page of copied) doc.addPage(page);
  }

  /**
   * `useObjectStreams: false` keeps the output a plain cross-reference table.
   *
   * It costs a few KB and buys two things worth more than that: the bytes stay greppable for the
   * document number when somebody is verifying a file by hand, and every PDF reader in the wild -
   * including the old ones a student might open an attachment in - can read it without an
   * incremental-update code path.
   */
  const out = await doc.save({ useObjectStreams: false });
  return Buffer.from(out);
}

// ───────────────────────────── Drawing ─────────────────────────────

/** Fit the ink inside its box, preserving aspect. A stretched signature is a forged-looking one. */
async function drawInk(
  doc: PDFDocument,
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  dataUrl: string,
) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const png = await doc.embedPng(Buffer.from(base64, "base64"));
  const scale = Math.min(rect.width / png.width, rect.height / png.height);
  const w = png.width * scale;
  const h = png.height * scale;
  page.drawImage(png, {
    // Centred horizontally, sitting on the bottom of the box - where a signature sits on a line.
    x: rect.x + (rect.width - w) / 2,
    y: rect.y,
    width: w,
    height: h,
  });
}

/**
 * The box as it looks before anybody has filled it: a tinted panel, a signing line, and the
 * caption. Drawn only on an unsigned render - a sealed copy has no empty zones to advertise.
 */
function drawEmptyZone(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  caption: string,
  font: PDFFont,
) {
  page.drawRectangle({
    ...rect,
    color: ZONE_FILL,
    borderColor: ZONE_LINE,
    borderWidth: 0.8,
    opacity: 0.85,
    borderOpacity: 1,
  });
  page.drawLine({
    start: { x: rect.x + 6, y: rect.y + 8 },
    end: { x: rect.x + rect.width - 6, y: rect.y + 8 },
    thickness: 0.6,
    color: ZONE_LINE,
  });
  const size = 6.5;
  const text = winAnsiLine(caption).toUpperCase();
  const fitted = truncate(text, font, size, rect.width - 12);
  page.drawText(fitted, {
    x: rect.x + 6,
    y: rect.y + rect.height - size - 4,
    size,
    font,
    color: CHROME_GREY,
  });
}

/**
 * A tick box: the square always, the tick only when it was ticked.
 *
 * `ticked === null` means nobody has answered yet, which is an empty square - distinct from
 * `false`, which means the signer went through the ceremony and deliberately left an optional box
 * alone. The two must not look the same, because only one of them is a fact about the contract.
 */
function drawTickBox(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  ticked: boolean | null | undefined,
) {
  // A square, sized to the shorter side of the placed box and pinned to its top-left, so a
  // generously drawn hit area does not become a giant checkbox.
  const side = Math.max(8, Math.min(14, Math.min(rect.width, rect.height)));
  const x = rect.x;
  const y = rect.y + rect.height - side;

  page.drawRectangle({
    x,
    y,
    width: side,
    height: side,
    color: rgb(1, 1, 1),
    borderColor: ZONE_LINE,
    borderWidth: 0.9,
  });

  if (ticked !== true) return;

  const tick = rgb(0.12, 0.31, 0.47);
  page.drawLine({
    start: { x: x + side * 0.22, y: y + side * 0.5 },
    end: { x: x + side * 0.42, y: y + side * 0.25 },
    thickness: 1.4,
    color: tick,
  });
  page.drawLine({
    start: { x: x + side * 0.42, y: y + side * 0.25 },
    end: { x: x + side * 0.8, y: y + side * 0.74 },
    thickness: 1.4,
    color: tick,
  });
}

/** A date, a name or a typed value, sat on the baseline of its box and never overflowing it. */
function drawFieldText(
  page: PDFPage,
  rect: { x: number; y: number; width: number; height: number },
  value: string,
  font: PDFFont,
) {
  // Fit to the box: big enough to read beside the printed text, small enough never to spill.
  const size = Math.max(7, Math.min(11, rect.height - 4));
  const text = truncate(winAnsiLine(value), font, size, rect.width - 4);
  page.drawText(text, {
    x: rect.x + 2,
    y: rect.y + Math.max(1, (rect.height - size) / 2),
    size,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawWatermark(page: PDFPage, font: PDFFont) {
  const { width, height } = page.getSize();
  const size = Math.min(72, width / 5.2);
  const text = "UNSIGNED";
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    // Rotated 45° about its own origin, so the start point is offset to keep it centred.
    x: width / 2 - (textWidth / 2) * Math.cos(Math.PI / 4),
    y: height / 2 - (textWidth / 2) * Math.sin(Math.PI / 4),
    size,
    font,
    color: WATERMARK,
    rotate: degrees(45),
    opacity: 0.9,
  });
}
