import "server-only";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import {
  DEFAULT_FIELD_SIZE,
  MAX_FIELD_LABEL,
  nextFieldId,
  type DocField,
  type FieldKind,
  type SignerRole,
} from "@/lib/agreement-doc";

/**
 * Reading the fields a FILLABLE PDF already declares, and turning them into our own.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────
 * A PDF exported from Word with form fields, or produced by any contract tool, already says
 * exactly where each box goes and what it is for. Making the founder drag those same boxes again
 * by hand is work the document itself has already done. (Zoho does this too; it is the one piece
 * of their field handling we had no answer for.)
 *
 * ── WHY THE ANNOTATIONS AND NOT `form.getFields()` ──────────────────────────────────────────
 * pdf-lib's form API gives a flat list of fields, and a field's widgets do not carry the page they
 * are on - which is the one thing we cannot do without, since our coordinates are per page. Walking
 * each page's `/Annots` gives the page association for free, and the widget dictionary carries
 * everything else: `/Rect`, `/FT`, `/T`, `/Ff`.
 *
 * ── WHAT IT IS ALLOWED TO GET WRONG ─────────────────────────────────────────────────────────
 * Everything. This is a SUGGESTION, presented to the founder in the designer for them to correct,
 * and nothing is issued without `validateDocBody` agreeing that both parties have a signature box.
 * So the heuristics below are allowed to misread a field name - what they must never do is throw,
 * because then a perfectly good PDF would be unusable. Every lookup is defensive for that reason.
 */

export type DetectedFields = {
  fields: DocField[];
  /** Widgets we saw but could not use - a push button, a radio group, a field with no box. */
  skipped: number;
};

/** `/Ff` flag bits, from the PDF spec. Only the three that change what a field IS. */
const FF_REQUIRED = 1 << 1; // bit position 2
const FF_RADIO = 1 << 15; // bit position 16
const FF_PUSHBUTTON = 1 << 16; // bit position 17

export function detectAcroFormFields(doc: PDFDocument): DetectedFields {
  const fields: DocField[] = [];
  let skipped = 0;

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const annots = safe(() => page.node.Annots());
    if (!annots || !(annots instanceof PDFArray)) return;

    const box = pageBox(page);

    for (let i = 0; i < annots.size(); i++) {
      const dict = safe(() => doc.context.lookup(annots.get(i), PDFDict));
      if (!dict) continue;

      const subtype = nameOf(dict, "Subtype");
      if (subtype !== "Widget") continue;

      // `/FT` and `/T` may live on the widget or be inherited from its parent field.
      const parent = safe(() => dict.lookup(PDFName.of("Parent"), PDFDict));
      const fieldType = nameOf(dict, "FT") ?? (parent ? nameOf(parent, "FT") : null);
      const name = textOf(dict, "T") ?? (parent ? textOf(parent, "T") : null) ?? "";
      const flags = numberOf(dict, "Ff") ?? (parent ? numberOf(parent, "Ff") : 0) ?? 0;

      if (!fieldType) {
        skipped++;
        continue;
      }
      // A push button does nothing on paper, and a radio group has no equivalent in our model -
      // one of N is not something a contract box can express here.
      if (fieldType === "Btn" && (flags & FF_PUSHBUTTON || flags & FF_RADIO)) {
        skipped++;
        continue;
      }

      const rect = rectOf(dict);
      if (!rect || !box) {
        skipped++;
        continue;
      }

      const kind = kindFor(fieldType, name);
      const signer = signerFor(name);
      const normalised = normalise(rect, box, kind);
      if (!normalised) {
        skipped++;
        continue;
      }

      const field: DocField = {
        id: nextFieldId(fields),
        kind,
        signer,
        ...normalised,
        page: index + 1,
      };
      // The document's own label is better than ours whenever it is readable - "Student signature"
      // beats "Student - signature", and it is what the person who made the PDF called it.
      const label = humanise(name);
      if (label) field.label = label;
      if (flags & FF_REQUIRED && (kind === "CHECKBOX" || kind === "TEXT")) field.required = true;

      fields.push(field);
    }
  });

  return { fields, skipped };
}

// ───────────────────────────── Geometry ─────────────────────────────

type Box = { x: number; y: number; width: number; height: number };

/**
 * The page's own coordinate box.
 *
 * A MediaBox does not have to start at (0,0) - plenty of print-ready exports are offset - and a
 * widget's `/Rect` is in the same space. Subtracting the origin is the difference between a box
 * that lands on the signature line and one that lands off the page.
 */
function pageBox(page: { getMediaBox?: () => Box; getSize: () => { width: number; height: number } }): Box | null {
  const media = safe(() => page.getMediaBox?.());
  if (media && Number.isFinite(media.width) && media.width > 0) return media;
  const size = safe(() => page.getSize());
  return size ? { x: 0, y: 0, width: size.width, height: size.height } : null;
}

function rectOf(dict: PDFDict): [number, number, number, number] | null {
  const arr = safe(() => dict.lookup(PDFName.of("Rect"), PDFArray));
  if (!arr || arr.size() < 4) return null;
  const nums = [0, 1, 2, 3].map((i) => {
    const n = safe(() => arr.lookup(i, PDFNumber));
    return n ? n.asNumber() : NaN;
  });
  return nums.every((n) => Number.isFinite(n)) ? (nums as [number, number, number, number]) : null;
}

/**
 * PDF points (bottom-left origin) → our fractions of the page from the TOP-left.
 *
 * `/Rect` corners are not guaranteed to be in any particular order, so both axes are min/maxed
 * rather than assumed. A zero-area widget - which some generators emit for a hidden field - is
 * rejected rather than becoming an invisible box the founder cannot find to delete.
 */
function normalise(
  rect: [number, number, number, number],
  box: Box,
  kind: FieldKind,
): { x: number; y: number; w: number; h: number } | null {
  const [x1, y1, x2, y2] = rect;
  const left = Math.min(x1, x2) - box.x;
  const right = Math.max(x1, x2) - box.x;
  const bottom = Math.min(y1, y2) - box.y;
  const top = Math.max(y1, y2) - box.y;

  const w = (right - left) / box.width;
  const h = (top - bottom) / box.height;
  if (!(w > 0.002) || !(h > 0.002)) return null;

  const x = left / box.width;
  const y = 1 - top / box.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.05 || y < -0.05) return null;

  // Clamp into the page. A widget that hangs slightly off the edge is common and harmless; one
  // that would fail `validateDocBody`'s "runs off the page" check is not worth importing as-is.
  const clampedW = Math.min(w, 1);
  const clampedH = Math.min(h, 1);
  return {
    x: Math.min(Math.max(x, 0), 1 - clampedW),
    y: Math.min(Math.max(y, 0), 1 - clampedH),
    w: Math.max(clampedW, DEFAULT_FIELD_SIZE[kind].w * 0.25),
    h: Math.max(clampedH, 0.012),
  };
}

// ───────────────────────────── Heuristics ─────────────────────────────

function kindFor(fieldType: string, name: string): FieldKind {
  if (fieldType === "Sig") return "SIGNATURE";
  if (fieldType === "Btn") return "CHECKBOX";

  const n = name.toLowerCase();
  /**
   * ORDER IS THE WHOLE ALGORITHM, and it runs most-specific first.
   *
   * `student.sign_date` and `signature_date` both contain "sign", so a signature test placed
   * before the date test claims them - and a date box becomes a second signature box, which then
   * makes the document look as though the student signs twice. "Signature" contains no "date", so
   * checking date first costs nothing and fixes both names.
   */
  if (/date|dob/.test(n)) return "DATE";
  if (/initial/.test(n)) return "INITIALS";
  if (/sign/.test(n) && !/design|assign/.test(n)) return "SIGNATURE";
  if (/\bname\b|fullname|full_name|printed/.test(n)) return "NAME";
  if (/attach|upload|file|document/.test(n)) return "ATTACHMENT";
  return "TEXT";
}

/**
 * Who the field belongs to, guessed from its name.
 *
 * Defaults to STUDENT, because on a contract most boxes are the counterparty's and the founder is
 * correcting a list rather than building one. Everything here is visible and editable in the
 * designer before anything is sent.
 */
function signerFor(name: string): SignerRole {
  const n = name.toLowerCase();
  if (/b2|coach|mentor|provider|company|consultant|witness_b2|director/.test(n)) return "CREATOR";
  if (/guardian|parent|witness|co.?sign|father|mother/.test(n)) return "GUARDIAN";
  return "STUDENT";
}

/** "student_signature_1" → "Student signature 1". Empty when the name carries no words. */
function humanise(name: string): string | null {
  const cleaned = name
    .replace(/[._\-\[\]]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/[a-zA-Z]/.test(cleaned)) return null;
  const label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return label.slice(0, MAX_FIELD_LABEL);
}

// ───────────────────────────── Defensive lookups ─────────────────────────────

/**
 * Every read of a PDF dictionary goes through here.
 *
 * pdf-lib throws when a lookup finds the wrong type, and the documents being read were produced by
 * software we do not control. One malformed annotation must cost us that annotation, not the
 * upload - so the caller treats a null as "skip this widget" and carries on.
 */
function safe<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}

function nameOf(dict: PDFDict, key: string): string | null {
  const value = safe(() => dict.lookup(PDFName.of(key), PDFName));
  return value ? value.asString().replace(/^\//, "") : null;
}

function numberOf(dict: PDFDict, key: string): number | null {
  const value = safe(() => dict.lookup(PDFName.of(key), PDFNumber));
  return value ? value.asNumber() : null;
}

function textOf(dict: PDFDict, key: string): string | null {
  const str = safe(() => dict.lookup(PDFName.of(key), PDFString));
  if (str) return str.asString();
  const hex = safe(() => dict.lookup(PDFName.of(key), PDFHexString));
  return hex ? hex.decodeText() : null;
}
