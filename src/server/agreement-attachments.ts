import "server-only";
import { prisma } from "@/lib/prisma";
import { sha256Hex, toOwnedBytes } from "@/lib/agreement-token";
import type { DocField, SignerRole } from "@/lib/agreement-doc";

/**
 * Files a SIGNER uploads during their ceremony - an ID, a photo, a certificate - into a field the
 * founder marked as ATTACHMENT.
 *
 * ── THIS IS NOT A GENERAL UPLOADER, AND THE DEFENCES ARE NOT THE USUAL ONES ─────────────────
 * The endpoint has to be public: the person uploading their passport has no account. So the
 * guards come from somewhere else, and every one of them is necessary:
 *
 *   1. BOUND TO A FIELD. The request must name a field that exists on THIS agreement's body, is
 *      of kind ATTACHMENT, and belongs to the role the token authenticates. There is no way to
 *      call this as "store a file for me".
 *   2. ONE FILE PER FIELD. A unique index on (agreementId, fieldId) means re-uploading replaces;
 *      nobody can accumulate storage against one box.
 *   3. SNIFFED, never trusted. The type comes from the magic bytes, not the filename and not the
 *      browser's Content-Type, and the allow-list is five formats long.
 *   4. SIZE CAPPED well below the PDF limit.
 *   5. DRAFT-SAFE: the parent agreement must still be unsigned. A sealed contract takes no new
 *      evidence.
 *
 * Bytes live in Postgres, not the Supabase bucket, for the reason the rest of this module gives:
 * that bucket is public-read, and this is somebody's identity document.
 */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export type SniffedType = { ext: string; mime: string };

/**
 * Identify a file by its leading bytes.
 *
 * Deliberately not a library - the allow-list is five formats, and the alternative is a dependency
 * parsing attacker-controlled bytes on a public endpoint. Mirrors `/api/form-upload`'s sniffer,
 * minus the legacy `.doc` branch: nothing here needs to accept an OLE compound file.
 */
export function sniffAttachment(buf: Buffer): SniffedType | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  const at = (offset: number, ascii: string) =>
    buf.subarray(offset, offset + ascii.length).toString("latin1") === ascii;

  if (startsWith(0xff, 0xd8, 0xff)) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return { ext: "png", mime: "image/png" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { ext: "webp", mime: "image/webp" };
  if (at(0, "%PDF-")) return { ext: "pdf", mime: "application/pdf" };
  // A .docx is a zip container. Stored with the Word content type so a browser downloads it
  // rather than trying to render anything out of it.
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    return {
      ext: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return null;
}

export type AttachmentResult =
  | { ok: true; filename: string; size: number; sha256: string }
  | { ok: false; error: string };

/**
 * Store one file against one field. Replaces whatever was there.
 *
 * `role` comes from the TOKEN, never from the request body - that is what stops a guardian
 * uploading into the student's box and the other way round.
 */
export async function storeAgreementAttachment(input: {
  agreementId: string;
  fields: readonly DocField[];
  fieldId: string;
  role: SignerRole;
  filename: string;
  bytes: Buffer;
}): Promise<AttachmentResult> {
  const field = input.fields.find((f) => f.id === input.fieldId);
  if (!field) return { ok: false, error: "That upload box is not part of this agreement." };
  if (field.kind !== "ATTACHMENT") return { ok: false, error: "That field does not take a file." };
  if (field.signer !== input.role) {
    return { ok: false, error: "That upload box belongs to somebody else on this agreement." };
  }

  if (input.bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `That file is ${(input.bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB.`,
    };
  }

  const sniffed = sniffAttachment(input.bytes);
  if (!sniffed) {
    return { ok: false, error: "Please upload a PDF, a JPG, a PNG, a WEBP image or a Word document." };
  }

  // A sealed agreement takes no new evidence - checked here rather than relying on the caller.
  const parent = await prisma.agreement.findUnique({
    where: { id: input.agreementId },
    select: { signedAt: true, status: true },
  });
  if (!parent) return { ok: false, error: "Agreement not found." };
  if (parent.signedAt || parent.status === "VOIDED" || parent.status === "DECLINED") {
    return { ok: false, error: "This agreement is no longer accepting uploads." };
  }

  /**
   * The stored filename is REBUILT, never taken from the client.
   *
   * It is printed on the document and offered as a download, so a crafted name is the one way a
   * file could misrepresent itself - `invoice.pdf.exe`, or a name full of path separators. The
   * base is stripped to a safe character set and the extension comes from the SNIFF.
   */
  const base = input.filename
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 60);
  const filename = `${base || "attachment"}.${sniffed.ext}`;

  const stored = {
    signerRole: input.role,
    bytes: toOwnedBytes(input.bytes),
    filename,
    mimeType: sniffed.mime,
    size: input.bytes.length,
    sha256: sha256Hex(input.bytes),
  };

  await prisma.agreementAttachment.upsert({
    where: { agreementId_fieldId: { agreementId: input.agreementId, fieldId: input.fieldId } },
    create: { agreementId: input.agreementId, fieldId: input.fieldId, ...stored },
    update: stored,
  });

  return { ok: true, filename, size: stored.size, sha256: stored.sha256 };
}

/**
 * Has every REQUIRED upload box for this signer actually got a file behind it?
 *
 * The signer's typed answers carry the filename so it can be printed, but a filename in a JSON
 * blob is a client-supplied string - this is the check that it corresponds to bytes we hold.
 * Without it, "required attachment" would mean "the browser said it attached something".
 */
export async function attachmentsSatisfied(
  agreementId: string,
  fields: readonly DocField[],
  role: SignerRole,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const required = fields.filter(
    (f) => f.kind === "ATTACHMENT" && f.signer === role && f.required,
  );
  if (required.length === 0) return { ok: true };

  const rows = await prisma.agreementAttachment.findMany({
    where: { agreementId, fieldId: { in: required.map((f) => f.id) } },
    select: { fieldId: true },
  });
  const have = new Set(rows.map((r) => r.fieldId));

  const missing = required.find((f) => !have.has(f.id));
  if (missing) {
    return {
      ok: false,
      error: `Please attach a file for “${missing.label?.trim() || "the upload box"}”.`,
    };
  }
  return { ok: true };
}

/** What the founder's screen lists. Never the bytes. */
export async function listAgreementAttachments(agreementId: string) {
  return prisma.agreementAttachment.findMany({
    where: { agreementId },
    select: {
      id: true,
      fieldId: true,
      signerRole: true,
      filename: true,
      mimeType: true,
      size: true,
      sha256: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "asc" },
  });
}
