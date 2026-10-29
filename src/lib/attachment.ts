/**
 * FILES ATTACHED TO AN IMPROVEMENT REPORT - the whole contract, in one isomorphic file.
 *
 * Pure, no prisma, no `server-only`, for exactly the reason `lib/recording.ts` is: the picker
 * (client) decides what it will offer from this file and the upload route (server) decides what
 * it will accept from the very same table. A picker whose `accept` attribute allows a format the
 * route then refuses is a feature that fails only in the field, for the one person who had the
 * spreadsheet that would have explained everything.
 *
 * ── WHY THIS EXISTS ALONGSIDE RECORDINGS ───────────────────────────────────────────────────
 * A recording shows what the app did. An attachment is the evidence from OUTSIDE the app: the
 * bank statement the figure should have matched, the invoice the student was sent, the
 * spreadsheet the founder keeps the real numbers in, the screenshot taken on a phone where
 * screen capture does not exist. None of that can be recorded from a browser tab, and none of
 * it fits in a text box.
 *
 * ── WHAT AN ATTACHMENT DOES *NOT* DO ───────────────────────────────────────────────────────
 * It does not excuse the questions. A recording does - see `answersComplete` - because somebody
 * who talked through the problem has genuinely answered "what were you doing". A PDF has
 * answered nothing: a file with no words around it is a worse report than three short sentences,
 * and triage cannot read it from the queue. So the stars stay on the required questions.
 *
 * ── WHERE THE BYTES LIVE ───────────────────────────────────────────────────────────────────
 * In Postgres, served by an authenticated route - the pattern `AgreementAttachment` set for
 * private files and `ImprovementRecording` followed. NOT in the Supabase bucket: that bucket is
 * public-read by design (it is the marketing site's media origin) and a bank statement somebody
 * attached to a bug report has no business behind a guessable public URL.
 */

// ─────────────────────────────── caps ───────────────────────────────

/**
 * Per file. A scan of a two-page statement is ~2 MB and a phone photo of a screen is ~4; 10 MB
 * is the same ceiling `/api/form-upload` settled on for a CV, and it is comfortably above
 * anything a report legitimately needs.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * How many files one report may carry, and the budget across all of them.
 *
 * Both exist, and the total is the one that matters: five files of 10 MB would be 50 MB of bytea
 * hanging off a row the queue reads, and a report needing five large files is a conversation,
 * not a form. The count is there as well so the UI can say "three of five" rather than quoting a
 * byte budget at somebody who just wants to add a screenshot.
 */
export const ATTACHMENT_MAX_COUNT = 5;
export const ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

// ─────────────────────────────── the allow-list ───────────────────────────────

export type SniffedAttachment = {
  /** The extension the STORED filename gets. Comes from the sniff, never from the client's name. */
  ext: string;
  /** The stored `Content-Type`, which becomes the `Content-Type` of a download response. */
  mime: string;
};

/**
 * Word, Excel and PowerPoint in their modern form, all of which are Zip containers.
 *
 * ── WHY THE MEMBER COMES FROM THE FILENAME, AND WHY THAT IS STILL SAFE ─────────────────────
 * `.docx`, `.xlsx` and `.pptx` are byte-identical in their header: all three start `PK 03 04`,
 * and telling them apart means parsing the Zip central directory - a dependency reading
 * uploaded bytes, for no real gain. So the FAMILY comes from the bytes (it is a Zip) and the
 * MEMBER comes from the client's extension.
 *
 * This is the same shape of argument `recordingMime` makes about `audio/webm` versus
 * `video/webm`, and it holds for the same reason. The security property is that a stored type is
 * always drawn from THIS table and never from the request, so an uploader cannot cause
 * `text/html` to be served back from this origin. Lying about the member only picks a different
 * download-only Office type: the worst outcome is Excel being handed a file Word wrote, which
 * harms nobody and is immediately obvious to the person who did it.
 *
 * A Zip whose name is none of the three is REFUSED rather than stored as a generic archive. This
 * is a bug-report attachment, not a file drop, and "accept any Zip" is how an allow-list of
 * eight formats quietly becomes an allow-list of everything.
 */
const OOXML: Record<string, SniffedAttachment> = {
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};

/**
 * The pre-2007 Office formats, which are all one OLE compound file and share `D0 CF 11 E0`.
 * Resolved by extension for the reason above, and defaulted to `.doc` - which is what an
 * unlabelled OLE file on this company's shared drive almost always is.
 *
 * Worth accepting at all because the founder's older records genuinely are `.xls`, and a report
 * about a figure that disagrees with a spreadsheet is not much use without the spreadsheet.
 */
const OLE: Record<string, SniffedAttachment> = {
  doc: { ext: "doc", mime: "application/msword" },
  xls: { ext: "xls", mime: "application/vnd.ms-excel" },
  ppt: { ext: "ppt", mime: "application/vnd.ms-powerpoint" },
};

/** The ISO-BMFF brands that mean "a photo from a phone". Deliberately NOT `isom`/`mp4` - see below. */
const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"];

/**
 * Every type this app will store on a report, which is also every type the download route may
 * emit. Nothing here renders executable content in a browser, and the route serves all of it as
 * `attachment` regardless - see that route's own note on why even an image is a download.
 */
export const ATTACHMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  ...Object.values(OOXML).map((f) => f.mime),
  ...Object.values(OLE).map((f) => f.mime),
];

export function isStorableAttachmentMime(value: string): boolean {
  return ATTACHMENT_MIME_TYPES.includes(value);
}

/** What the file picker offers. Kept beside the sniff so the two cannot drift apart. */
export const ATTACHMENT_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".heic",
].join(",");

/** What the form tells a person they can send, in words rather than extensions. */
export const ATTACHMENT_ACCEPT_LABEL = "PDF, Word, Excel, PowerPoint or an image";

// ─────────────────────────────── the sniff ───────────────────────────────

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** `"%PDF-"` as bytes. Built here so this file needs no TextEncoder and stays isomorphic. */
function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function brandAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = offset; i < offset + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out.toLowerCase();
}

/** `"Q3 figures.XLSX"` -> `"xlsx"`. Empty when there is no extension to read. */
export function extensionOf(filename: string | null | undefined): string {
  const name = (filename ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * What the bytes ACTUALLY are, read from their own leading bytes.
 *
 * The browser's `Content-Type` and the filename are both client-controlled - anyone with a
 * session can send whatever they like - and the value this returns becomes the `Content-Type` of
 * a response served from this origin. So the type is DETERMINED here, and the request's claim is
 * used for exactly one thing: choosing between members of a family whose headers are identical,
 * which the notes on `OOXML` and `OLE` argue is safe.
 *
 * Null for anything unrecognised, and the route turns that into a 415. There is deliberately no
 * "probably fine" branch and no `application/octet-stream` fallback: a fallback that accepts
 * unidentified bytes is not an allow-list. A plain-text branch would be the same mistake in
 * disguise - text has no magic bytes at all, so accepting `.txt` means accepting anything - which
 * is why `.txt`, `.csv` and `.log` are not offered. Words belong in the form's own boxes, where
 * triage can read them from the queue without downloading anything.
 *
 * Deliberately not a library. The list is eight formats long and the alternative is a dependency
 * parsing uploaded bytes; `/api/form-upload` and `server/agreement-attachments.ts` each made the
 * same call. Those two are NOT folded into this file on purpose: both are UNAUTHENTICATED
 * endpoints with deliberately narrower lists, and widening either to match this one would be a
 * security change dressed up as a refactor.
 */
export function sniffAttachment(
  bytes: Uint8Array,
  filename?: string | null,
): SniffedAttachment | null {
  const ext = extensionOf(filename);

  if (matches(bytes, 0, ascii("%PDF-"))) return { ext: "pdf", mime: "application/pdf" };

  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: "png", mime: "image/png" };
  }
  if (matches(bytes, 0, ascii("RIFF")) && matches(bytes, 8, ascii("WEBP"))) {
    return { ext: "webp", mime: "image/webp" };
  }
  if (matches(bytes, 0, ascii("GIF8"))) return { ext: "gif", mime: "image/gif" };

  /**
   * HEIC - what an iPhone camera produces, and therefore what a photo OF a broken screen
   * arrives as from exactly the people who cannot record their screen at all.
   *
   * The BRAND is checked, not just `ftyp`, because every MP4 and MOV in the world also carries
   * `ftyp` at offset 4. An unbranded ISO-BMFF file is a video, and video belongs in a recording.
   */
  if (matches(bytes, 4, ascii("ftyp")) && HEIF_BRANDS.includes(brandAt(bytes, 8, 4))) {
    return { ext: "heic", mime: "image/heic" };
  }

  // Zip container: Word/Excel/PowerPoint, resolved by extension. See the note on `OOXML`.
  if (matches(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    // A macro-enabled workbook is the one alias worth carrying: it is an ordinary xlsx to every
    // reader here, and refusing it would send somebody away to re-save their own spreadsheet.
    return OOXML[ext === "xlsm" ? "xlsx" : ext] ?? null;
  }
  // OLE compound file: the legacy trio, defaulting to Word. See the note on `OLE`.
  if (matches(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return OLE[ext] ?? OLE.doc;
  }

  return null;
}

// ─────────────────────────────── naming and display ───────────────────────────────

/**
 * The stored filename, REBUILT rather than taken from the client.
 *
 * It is rendered on the triage screen and offered as a download, so a crafted name is the one
 * way a stored file could misrepresent itself: `statement.pdf.exe`, a name full of path
 * separators, or a quote that breaks out of the `Content-Disposition` parameter it gets
 * interpolated into. The person's own words are kept - they are how triage tells one file from
 * another - but reduced to a safe character set, and the extension always comes from the SNIFF.
 */
export function safeAttachmentName(filename: string | null | undefined, ext: string): string {
  const base = (filename ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || "attachment"}.${ext}`;
}

/** `"2.4 MB"`, `"812 KB"`. A raw byte count tells a reader nothing about whether to open it. */
export function formatFileSize(bytes: number): string {
  const n = Math.max(0, Math.round(bytes));
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** What the triage screen calls it, from the type we stored rather than the name we were given. */
export function attachmentTypeLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "Word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "Excel";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") {
    return "PowerPoint";
  }
  return "File";
}

/**
 * Whether a set of files already chosen can take one more, and why not.
 *
 * Shared between the picker and the upload route so the two agree on the refusal AND on its
 * wording: the form that stopped somebody and the server that would have stopped them should not
 * be giving different reasons for it.
 */
export function attachmentRejection(
  existing: readonly { size: number }[],
  incoming: { size: number; name?: string },
): string | null {
  if (incoming.size === 0) return "That file is empty.";
  if (incoming.size > ATTACHMENT_MAX_BYTES) {
    return `${incoming.name ? `“${incoming.name}” is` : "That file is"} ${formatFileSize(incoming.size)}. The limit is ${formatFileSize(ATTACHMENT_MAX_BYTES)} per file.`;
  }
  if (existing.length >= ATTACHMENT_MAX_COUNT) {
    return `You can attach ${ATTACHMENT_MAX_COUNT} files to one report.`;
  }
  const total = existing.reduce((sum, f) => sum + f.size, 0) + incoming.size;
  if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
    return `That would be ${formatFileSize(total)} of attachments. The limit is ${formatFileSize(ATTACHMENT_MAX_TOTAL_BYTES)} for one report.`;
  }
  return null;
}
