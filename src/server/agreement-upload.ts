import "server-only";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import { sha256Hex, toOwnedBytes } from "@/lib/agreement-token";
import { docBlocksSchema, docFieldsSchema, type DocBlock, type DocField } from "@/lib/agreement-doc";
import { htmlToBlocks } from "@/lib/docx-blocks";
import { detectAcroFormFields } from "./agreement-acroform";

/**
 * Turning an uploaded file into a document body. The one place a `.docx` or a `.pdf` the app did
 * not produce is opened.
 *
 * ── TREAT EVERY UPLOAD AS HOSTILE ───────────────────────────────────────────────────────────
 * Not because the founder is, but because this is the only route by which a file from outside
 * reaches a PDF renderer and a database. So: the magic number decides the type, never the
 * filename or the browser's `Content-Type`; the size is capped before anything parses it; and
 * the parsed result is re-validated through the same zod schemas that guard a stored body
 * (`docBlocksSchema`), so a pathological document cannot produce a shape the renderer has never
 * seen.
 *
 * ── WHY MAMMOTH AND NOT A CONVERTER ─────────────────────────────────────────────────────────
 * Converting `.docx` to PDF properly means LibreOffice, which means a ~400MB layer and a headless
 * soffice process on a 1 vCPU VPS with no swap. The DOCX path therefore re-typesets the content
 * in B2's own document style (mammoth gives us semantic HTML; `lib/docx-blocks` gives us blocks),
 * and the founder who needs Word's exact layout exports a PDF and uploads that instead.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 - every .docx is a zip
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

export type UploadFailure = { ok: false; error: string };

/**
 * What Prisma's `Bytes` input demands: a `Uint8Array` over a real `ArrayBuffer`, not a view into
 * Node's shared Buffer pool. Inferred from `toOwnedBytes` rather than written out, because
 * annotating it `Uint8Array` defaults the type parameter back to `ArrayBufferLike` and undoes the
 * whole point - see the note on that function.
 */
type OwnedBytes = ReturnType<typeof toOwnedBytes>;

export type ParsedUpload =
  | {
      ok: true;
      kind: "DOCX";
      blocks: DocBlock[];
      fields: DocField[];
      dropped: { images: number; unsupported: number };
      bytes: OwnedBytes;
      sourceName: string;
      sourceMime: string;
      sourceSize: number;
      sourceSha256: string;
      /** Mammoth's own complaints - an unrecognised style, a lost footnote. Shown, never fatal. */
      warnings: string[];
    }
  | {
      ok: true;
      kind: "PDF";
      pageCount: number;
      pageSizes: { w: number; h: number }[];
      /**
       * Boxes read out of the PDF's own form fields, when it is a fillable one. A SUGGESTION the
       * founder corrects in the designer - see `agreement-acroform.ts`.
       */
      fields: DocField[];
      bytes: OwnedBytes;
      sourceName: string;
      sourceMime: string;
      sourceSize: number;
      sourceSha256: string;
      warnings: string[];
    };

/** Sniff the bytes. The extension and the MIME the browser claims are both advisory. */
export function sniffUploadKind(buf: Buffer): "DOCX" | "PDF" | null {
  if (buf.subarray(0, 4).equals(ZIP_MAGIC)) return "DOCX";
  // A PDF is allowed up to 1024 bytes of junk before its header, and some exporters use it.
  if (buf.subarray(0, 1024).includes(PDF_MAGIC)) return "PDF";
  return null;
}

/**
 * Parse an uploaded agreement document.
 *
 * `filename` is used for display only - sniffing decides what this actually is, so a `.pdf`
 * renamed to `.docx` is parsed as the PDF it is rather than failing confusingly inside mammoth.
 */
export async function parseUpload(
  file: { bytes: Buffer; filename: string },
): Promise<ParsedUpload | UploadFailure> {
  const { bytes, filename } = file;
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.` };
  }

  const kind = sniffUploadKind(bytes);
  if (!kind) {
    return { ok: false, error: "Upload a Word document (.docx) or a PDF. Older .doc files are not supported." };
  }

  const name = filename.trim().slice(0, 260) || (kind === "PDF" ? "document.pdf" : "document.docx");
  const common = {
    ok: true as const,
    bytes: toOwnedBytes(bytes),
    sourceName: name,
    sourceSize: bytes.length,
    sourceSha256: sha256Hex(bytes),
  };

  if (kind === "PDF") {
    const inspected = await inspectPdf(bytes);
    if (!inspected.ok) return inspected;
    return { ...common, kind: "PDF", sourceMime: PDF_MIME, ...inspected.value };
  }


  return parseDocx(bytes, common, name);
}

// ───────────────────────────── DOCX ─────────────────────────────

async function parseDocx(
  bytes: Buffer,
  common: {
    ok: true;
    bytes: OwnedBytes;
    sourceName: string;
    sourceSize: number;
    sourceSha256: string;
  },
  name: string,
): Promise<ParsedUpload | UploadFailure> {
  let html: string;
  let messages: { message: string }[] = [];
  try {
    const result = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        /**
         * Underline survives, because a contract uses it and mammoth drops it by default.
         * Nothing else is added: colours, fonts and sizes are deliberately NOT mapped - a DOCX
         * document is re-typeset in B2's document style, and honouring half of Word's formatting
         * produces something that looks broken rather than something that looks like Word.
         */
        styleMap: ["u => u", "r[style-name='Strong'] => strong"],
        /** No images in the block model, so do not spend memory base64-ing them into the HTML. */
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    html = result.value;
    messages = result.messages ?? [];
  } catch (e) {
    // A zip that is not a Word document, a corrupt file, a password-protected one.
    return {
      ok: false,
      error: `That .docx could not be read: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  const parsed = htmlToBlocks(html);
  if (parsed.blocks.length === 0) {
    return { ok: false, error: "That document has no text in it. Check you uploaded the right file." };
  }

  // Re-validate through the stored-body schemas. The parser is ours and is tested, but this is
  // the boundary where an uploaded file becomes data the renderer trusts - so it goes through the
  // same gate a row read back out of the database does.
  const blocks = docBlocksSchema.safeParse(parsed.blocks);
  if (!blocks.success) {
    return {
      ok: false,
      error:
        parsed.blocks.length > 2000
          ? "That document is too long to use as an agreement (over 2,000 paragraphs)."
          : "That document could not be converted into an editable agreement.",
    };
  }
  const fields = docFieldsSchema.safeParse(parsed.fields);
  if (!fields.success) {
    return { ok: false, error: "That document has too many signature placeholders (the limit is 60)." };
  }

  const warnings: string[] = [];
  if (parsed.dropped.images > 0) {
    warnings.push(
      `${parsed.dropped.images} image${parsed.dropped.images === 1 ? "" : "s"} were left out - a Word document is re-typeset here, not reproduced. Upload a PDF if the layout matters.`,
    );
  }
  for (const m of messages.slice(0, 5)) {
    if (m.message) warnings.push(m.message.slice(0, 200));
  }

  return {
    ...common,
    kind: "DOCX",
    sourceMime: DOCX_MIME,
    blocks: blocks.data,
    fields: fields.data,
    dropped: parsed.dropped,
    warnings,
  };
}

// ───────────────────────────── PDF ─────────────────────────────

/**
 * Open the PDF once, at upload, and record what the field designer and the stamper will need:
 * how many pages, and how big each one is in PDF points.
 *
 * Page sizes are captured HERE rather than re-derived later because the designer lays boxes out
 * in the browser against an aspect ratio, and the stamper converts those normalised boxes back
 * to points - both of them must be working from the same numbers as the document itself.
 */
async function inspectPdf(bytes: Buffer): Promise<
  | {
      ok: true;
      value: {
        pageCount: number;
        pageSizes: { w: number; h: number }[];
        fields: DocField[];
        warnings: string[];
      };
    }
  | UploadFailure
> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    // pdf-lib refuses an encrypted document rather than guessing. Say so plainly: "re-export
    // without a password" is something the founder can act on; a stack trace is not.
    if (/encrypt/i.test(message)) {
      return {
        ok: false,
        error: "That PDF is password-protected or encrypted. Re-export it from Word without protection.",
      };
    }
    return { ok: false, error: `That PDF could not be read: ${message}` };
  }

  const pages = doc.getPages();
  if (pages.length === 0) return { ok: false, error: "That PDF has no pages." };
  if (pages.length > 300) return { ok: false, error: "That PDF is longer than 300 pages." };

  /**
   * Import whatever boxes the document already declares.
   *
   * Wrapped, and the failure is a WARNING rather than an error: a PDF whose form dictionary we
   * cannot make sense of is still a perfectly good document to place boxes on by hand, and
   * refusing the upload over a malformed annotation would be the wrong trade entirely.
   */
  const warnings: string[] = [];
  let fields: DocField[] = [];
  try {
    const detected = detectAcroFormFields(doc);
    const parsed = docFieldsSchema.safeParse(detected.fields);
    if (parsed.success) {
      fields = parsed.data;
      if (fields.length > 0) {
        warnings.push(
          `${fields.length} field${fields.length === 1 ? "" : "s"} were read from the PDF's own form boxes. Check who each one belongs to before sending.`,
        );
      }
      if (detected.skipped > 0) {
        warnings.push(
          `${detected.skipped} form field${detected.skipped === 1 ? "" : "s"} could not be imported (a button, a radio group, or a box with no position). Place those by hand.`,
        );
      }
    } else if (detected.fields.length > 0) {
      warnings.push("This PDF's form fields could not be imported. Place the boxes by hand.");
    }
  } catch {
    warnings.push("This PDF's form fields could not be read. Place the boxes by hand.");
  }

  return {
    ok: true,
    value: {
      pageCount: pages.length,
      pageSizes: pages.map((p) => {
        const { width, height } = p.getSize();
        return { w: Math.round(width * 100) / 100, h: Math.round(height * 100) / 100 };
      }),
      fields,
      warnings,
    },
  };
}
