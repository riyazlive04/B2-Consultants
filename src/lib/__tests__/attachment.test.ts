import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_TOTAL_BYTES,
  ATTACHMENT_MIME_TYPES,
  attachmentRejection,
  attachmentTypeLabel,
  extensionOf,
  formatFileSize,
  isStorableAttachmentMime,
  safeAttachmentName,
  sniffAttachment,
} from "../attachment";

/**
 * The sniff is the security-relevant half of this module: what it returns decides the
 * `Content-Type` of a response served from this origin, and the extension of a file written to
 * somebody's Downloads folder. So the tests that matter most are the ones proving it REFUSES
 * things, not the ones proving it accepts a PDF.
 */

const bytes = (...parts: (number | string)[]) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const ch of part) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
};

const pdf = () => bytes("%PDF-1.7\n%âãÏÓ");
const png = () => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const jpg = () => bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF");
const webp = () => bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 ");
const gif = () => bytes("GIF89a", 1, 0, 1, 0);
const zip = () => bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0);
const ole = () => bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0);
/** `ftyp` at offset 4 with a HEIF brand at offset 8 - what an iPhone photo looks like. */
const heic = () => bytes(0, 0, 0, 0x18, "ftyp", "heic", "heic");
/** The same box structure with a VIDEO brand. This is an MP4 and must be refused. */
const mp4 = () => bytes(0, 0, 0, 0x18, "ftyp", "isom", "isom");

test("sniffAttachment recognises each format on the allow-list", () => {
  assert.deepEqual(sniffAttachment(pdf(), "x.pdf"), { ext: "pdf", mime: "application/pdf" });
  assert.deepEqual(sniffAttachment(png(), "x.png"), { ext: "png", mime: "image/png" });
  assert.deepEqual(sniffAttachment(jpg(), "x.jpg"), { ext: "jpg", mime: "image/jpeg" });
  assert.deepEqual(sniffAttachment(webp(), "x.webp"), { ext: "webp", mime: "image/webp" });
  assert.deepEqual(sniffAttachment(gif(), "x.gif"), { ext: "gif", mime: "image/gif" });
  assert.deepEqual(sniffAttachment(heic(), "IMG_0001.HEIC"), { ext: "heic", mime: "image/heic" });
});

test("the type comes from the BYTES, so a lying filename cannot change it", () => {
  // The whole point of sniffing. A PNG named .pdf is still stored and served as a PNG.
  assert.equal(sniffAttachment(png(), "statement.pdf")?.mime, "image/png");
  assert.equal(sniffAttachment(pdf(), "photo.png")?.mime, "application/pdf");
  // And a name alone buys nothing at all.
  assert.equal(sniffAttachment(bytes("not a document"), "report.pdf"), null);
});

test("sniffAttachment refuses everything else, including things that claim to be documents", () => {
  // The attack this exists to stop: a session holder storing HTML that a browser would then run
  // from this origin. If this ever returns non-null, that file is served back from b2app.
  assert.equal(sniffAttachment(bytes("<html><script>alert(1)</script>"), "a.pdf"), null);
  assert.equal(sniffAttachment(bytes("<?xml version=\"1.0\"?><svg xmlns=\"\">"), "a.svg"), null);
  // Windows executables and shell scripts, named as documents.
  assert.equal(sniffAttachment(bytes("MZ", 0x90, 0), "invoice.pdf"), null, "PE executable");
  assert.equal(sniffAttachment(bytes("#!/bin/sh\necho hi"), "notes.doc"), null, "shell script");
  assert.equal(sniffAttachment(bytes(0x7f, "ELF"), "x.pdf"), null, "ELF binary");
  // Plain text has NO magic bytes, which is exactly why .txt/.csv are not on the list: a
  // text branch would accept every one of the cases above.
  assert.equal(sniffAttachment(bytes("date,amount\n2026-10-01,500"), "ledger.csv"), null);
  assert.equal(sniffAttachment(bytes(""), "empty.pdf"), null, "empty body");
  assert.equal(sniffAttachment(bytes("%PD"), "truncated.pdf"), null, "truncated magic");
  // Media. A video belongs in a recording, not an attachment, and `ftyp` alone is not a photo.
  assert.equal(sniffAttachment(mp4(), "clip.mp4"), null, "mp4 brand is not a HEIF brand");
  assert.equal(sniffAttachment(bytes(0x1a, 0x45, 0xdf, 0xa3), "clip.webm"), null, "webm");
  assert.equal(sniffAttachment(bytes("ftypheic"), "x.heic"), null, "ftyp must be at offset 4");
});

test("the Office families resolve by extension, and only to members of their own family", () => {
  // Byte-identical headers, so the family is sniffed and the member is read off the name. The
  // security property is that the result is always one of OUR types - see the note on `OOXML`.
  assert.equal(sniffAttachment(zip(), "q3.docx")?.ext, "docx");
  assert.equal(sniffAttachment(zip(), "q3.xlsx")?.ext, "xlsx");
  assert.equal(sniffAttachment(zip(), "deck.pptx")?.ext, "pptx");
  assert.equal(sniffAttachment(zip(), "budget.XLSM")?.ext, "xlsx", "macro workbook reads as xlsx");
  assert.equal(sniffAttachment(ole(), "old.doc")?.ext, "doc");
  assert.equal(sniffAttachment(ole(), "old.xls")?.ext, "xls");
  assert.equal(sniffAttachment(ole(), "old.ppt")?.ext, "ppt");
  // An unlabelled OLE file is treated as Word; an unlabelled ZIP is REFUSED. The asymmetry is
  // deliberate: every OLE file here is an Office document, whereas a bare .zip is any bytes at
  // all, and "accept any archive" is how an allow-list stops being one.
  assert.equal(sniffAttachment(ole(), "mystery")?.ext, "doc");
  assert.equal(sniffAttachment(zip(), "mystery"), null);
  assert.equal(sniffAttachment(zip(), "logs.zip"), null, "a plain zip is not an Office document");
  assert.equal(sniffAttachment(zip(), "app.jar"), null);
  assert.equal(sniffAttachment(zip(), "x.odt"), null, "OpenDocument is a zip but not on the list");
});

test("every type the sniff can return is on the storable whitelist", () => {
  // The invariant that makes the route safe: a stored type is drawn from the table in this
  // module and never from a request header. If a format is added without being listed, the
  // download route would emit a type nothing here vouched for.
  const names = [
    "a.pdf", "a.png", "a.jpg", "a.webp", "a.gif", "a.heic",
    "a.docx", "a.xlsx", "a.pptx", "a.doc", "a.xls", "a.ppt", "a",
  ];
  const samples = [pdf(), png(), jpg(), webp(), gif(), heic(), zip(), ole()];
  for (const sample of samples) {
    for (const name of names) {
      const hit = sniffAttachment(sample, name);
      if (hit) assert.ok(isStorableAttachmentMime(hit.mime), `${name} -> ${hit.mime}`);
    }
  }
  assert.ok(!isStorableAttachmentMime("text/html"));
  assert.ok(!isStorableAttachmentMime("image/svg+xml"));
  assert.ok(!isStorableAttachmentMime("application/octet-stream"));
  assert.ok(!isStorableAttachmentMime("application/zip"));
});

test("the picker offers exactly what the sniff will accept", () => {
  // A picker that allows a format the route then refuses is a feature that fails in the field,
  // for the one person who had the file that would have explained everything.
  const offered = ATTACHMENT_ACCEPT.split(",");
  assert.ok(offered.length > 0);
  for (const ext of offered) {
    assert.ok(ext.startsWith("."), ext);
    const sample =
      ext === ".pdf" ? pdf()
      : ext === ".png" ? png()
      : ext === ".jpg" || ext === ".jpeg" ? jpg()
      : ext === ".webp" ? webp()
      : ext === ".gif" ? gif()
      : ext === ".heic" ? heic()
      : [".doc", ".xls", ".ppt"].includes(ext) ? ole()
      : zip();
    assert.ok(sniffAttachment(sample, `file${ext}`), `${ext} is offered but not accepted`);
  }
  // And nothing is offered that the sniff has no branch for.
  assert.ok(!offered.includes(".txt"));
  assert.ok(!offered.includes(".csv"));
  assert.ok(!offered.includes(".svg"));
  assert.ok(!offered.includes(".zip"));
});

test("safeAttachmentName cannot carry a path, a quote or a second extension", () => {
  // This string is interpolated into a Content-Disposition header and rendered on the triage
  // screen, so a crafted name is the one way a stored file could misrepresent itself.
  assert.equal(safeAttachmentName("Q3 statement.pdf", "pdf"), "Q3 statement.pdf");
  /**
   * `invoice.pdf.exe` becomes `invoice pdf.pdf` - the `.exe` is dropped with the old extension
   * and the INNER dot is flattened to a space, so the stored name cannot read as a double
   * extension at all. Better than `invoice.pdf.pdf`, which still looks like two.
   */
  assert.equal(safeAttachmentName("invoice.pdf.exe", "pdf"), "invoice pdf.pdf");
  const nasty = safeAttachmentName('../../etc/"passwd', "png");
  assert.ok(!nasty.includes("/"), nasty);
  assert.ok(!nasty.includes('"'), nasty);
  assert.ok(!nasty.includes(".."), nasty);
  assert.equal(safeAttachmentName("", "pdf"), "attachment.pdf");
  assert.equal(safeAttachmentName(null, "pdf"), "attachment.pdf");
  assert.equal(safeAttachmentName("...", "pdf"), "attachment.pdf", "a name of only dots");
  assert.equal(safeAttachmentName("%%%", "pdf"), "attachment.pdf", "a name of only punctuation");
  // The extension ALWAYS comes from the sniff, never from the name.
  assert.ok(safeAttachmentName("photo.png", "pdf").endsWith(".pdf"));
  // Long names are cut, because this is rendered in a table cell.
  assert.ok(safeAttachmentName("x".repeat(400) + ".pdf", "pdf").length <= 65);
});

test("extensionOf reads the last extension, lowercased, or nothing", () => {
  assert.equal(extensionOf("Q3 figures.XLSX"), "xlsx");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
  assert.equal(extensionOf("no-extension"), "");
  assert.equal(extensionOf(".hidden"), "", "a leading dot is not an extension");
  assert.equal(extensionOf("trailing."), "");
  assert.equal(extensionOf(null), "");
  assert.equal(extensionOf(undefined), "");
  assert.equal(extensionOf("weird.p d f"), "pdf", "spaces stripped, not treated as separate");
});

test("attachmentRejection enforces the per-file cap, the count and the total", () => {
  const ok = { size: 1_000_000, name: "a.pdf" };
  assert.equal(attachmentRejection([], ok), null);

  assert.match(attachmentRejection([], { size: 0, name: "a.pdf" }) ?? "", /empty/i);
  assert.match(
    attachmentRejection([], { size: ATTACHMENT_MAX_BYTES + 1, name: "big.pdf" }) ?? "",
    /limit is .* per file/i,
  );
  assert.equal(attachmentRejection([], { size: ATTACHMENT_MAX_BYTES }), null, "exactly at the cap");

  // The count, at the boundary.
  const full = Array.from({ length: ATTACHMENT_MAX_COUNT }, () => ({ size: 1000 }));
  assert.match(attachmentRejection(full, ok) ?? "", new RegExp(`${ATTACHMENT_MAX_COUNT} files`));
  assert.equal(attachmentRejection(full.slice(0, -1), { size: 1000 }), null);

  /**
   * THE TOTAL IS THE CAP THAT ACTUALLY BINDS. Three files inside the per-file limit can still
   * exceed the budget, and this is the check that catches it - the one a per-file-only guard
   * would miss, letting five 10 MB files become 50 MB of bytea on one row.
   */
  const heavy = [{ size: 9_000_000 }, { size: 9_000_000 }];
  assert.match(attachmentRejection(heavy, { size: 9_000_000 }) ?? "", /limit is .* for one report/i);
  assert.ok(9_000_000 * 3 > ATTACHMENT_MAX_TOTAL_BYTES, "the fixture must actually exceed it");
  // And the per-file limit alone would have let all three through, which is the point.
  assert.ok(9_000_000 < ATTACHMENT_MAX_BYTES);

  // The name is quoted into the message when there is one, and omitted when there is not.
  assert.match(
    attachmentRejection([], { size: ATTACHMENT_MAX_BYTES + 1, name: "big.pdf" }) ?? "",
    /big\.pdf/,
  );
  assert.match(
    attachmentRejection([], { size: ATTACHMENT_MAX_BYTES + 1 }) ?? "",
    /^That file is/,
  );
});

test("the caps stay in the range the module's own comments promise", () => {
  // Guards against a well-meaning bump. Each number is reasoned about in attachment.ts and
  // changing it is a decision, not a tweak.
  assert.equal(ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(ATTACHMENT_MAX_COUNT, 5);
  assert.equal(ATTACHMENT_MAX_TOTAL_BYTES, 20 * 1024 * 1024);
  assert.ok(
    ATTACHMENT_MAX_TOTAL_BYTES < ATTACHMENT_MAX_BYTES * ATTACHMENT_MAX_COUNT,
    "the total must bind before the count does, or it is decoration",
  );
  assert.ok(
    ATTACHMENT_MAX_BYTES > 1_000_000,
    "an attachment must be allowed to exceed the 1 MB server-action body limit",
  );
});

test("formatFileSize reads as a file size and not a number of bytes", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1_500_000), "1.4 MB");
  assert.equal(formatFileSize(10 * 1024 * 1024), "10.0 MB");
  assert.equal(formatFileSize(-1), "0 B", "never a negative size");
});

test("attachmentTypeLabel names the application, from the type we stored", () => {
  // Labelled from the SNIFFED type, not the filename: the triage screen should say Excel because
  // the bytes were a spreadsheet, not because somebody typed .xlsx.
  assert.equal(attachmentTypeLabel("application/pdf"), "PDF");
  assert.equal(attachmentTypeLabel("image/png"), "Image");
  assert.equal(attachmentTypeLabel("image/heic"), "Image");
  assert.equal(attachmentTypeLabel("application/msword"), "Word");
  assert.equal(attachmentTypeLabel("application/vnd.ms-excel"), "Excel");
  for (const mime of ATTACHMENT_MIME_TYPES) {
    assert.notEqual(attachmentTypeLabel(mime), "File", `${mime} fell through to the fallback`);
  }
  assert.equal(attachmentTypeLabel("application/x-unknown"), "File");
});
