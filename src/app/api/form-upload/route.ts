import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clientIpFrom, takeTokens, RATE_RULES } from "@/lib/rate-limit";
import { normaliseItems } from "@/lib/sites-types";
import { buildStorageKey, publicUrl, storageConfig, uploadObject } from "@/lib/supabase-storage";

/**
 * Attachment upload for a PUBLIC form's "File Upload" field.
 *
 * ── The thing to be careful about ──────────────────────────────────────────────────────────────
 * `/api/media/upload` carries a warning that an unauthenticated endpoint writing to a public
 * bucket is free anonymous file hosting on the company's domain, and that it will be found. This
 * endpoint is unauthenticated by necessity - the person uploading their CV has no account - so
 * every one of those words still applies and the defences have to come from somewhere else:
 *
 *  1. It is bound to a FORM. The request must name a published form that actually contains a
 *     `file` item. There is no way to call this as a general-purpose uploader.
 *  2. Rate limited per IP and globally, on the same buckets as form submission.
 *  3. Content is sniffed from its MAGIC BYTES, never from the client's `Content-Type` or the
 *     filename. The stored object is served with the type WE determined.
 *  4. Allow-list only: images, PDF, and Word documents - what a CV or a certificate arrives as.
 *     Explicitly not SVG (a script-bearing document) and not archives or anything executable.
 *  5. Size capped, and capped again against the field's own smaller limit if the author set one.
 *
 * A route handler rather than a server action because actions cannot stream a file body - the
 * whole payload would be serialised into the action argument.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling regardless of what the field says. A CV is under 2 MB; a scan of one is under 8. */
const MAX_BYTES = 10 * 1024 * 1024;

type Sniffed = { ext: string; mime: string };

/**
 * Identify a file by its leading bytes.
 *
 * Deliberately not a library: the allow-list is five formats long, and the alternative is a
 * dependency that parses attacker-controlled bytes on a public endpoint.
 */
function sniff(buf: Buffer): Sniffed | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  const at = (offset: number, ascii: string) => buf.subarray(offset, offset + ascii.length).toString("latin1") === ascii;

  if (startsWith(0xff, 0xd8, 0xff)) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return { ext: "png", mime: "image/png" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { ext: "webp", mime: "image/webp" };
  if (at(0, "%PDF-")) return { ext: "pdf", mime: "application/pdf" };
  // DOCX is a ZIP container. Accepted because that is what a CV arrives as, and it is stored with
  // the Word content type so a browser downloads it rather than trying to render anything.
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    return { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  // Legacy .doc (OLE compound file).
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) return { ext: "doc", mime: "application/msword" };
  return null;
}

export async function POST(req: NextRequest) {
  const ip = clientIpFrom(await Promise.resolve(headers()));
  const gate = takeTokens([
    { key: `form-upload:ip:${ip}`, rule: RATE_RULES.formPerIp },
    { key: "form-upload:global", rule: RATE_RULES.formGlobal },
  ]);
  if (!gate.ok) return NextResponse.json({ ok: false, error: "Too many uploads. Try again shortly." }, { status: 429 });

  const cfg = storageConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "File uploads are not configured on this site." }, { status: 503 });
  }

  let file: File | null = null;
  let formSlug = "";
  let itemId = "";
  try {
    const body = await req.formData();
    const f = body.get("file");
    if (f instanceof File) file = f;
    formSlug = String(body.get("form") ?? "");
    itemId = String(body.get("item") ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read the upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });

  // (1) Bound to a real, published form with a real file field on it.
  const dbForm = formSlug ? await prisma.form.findUnique({ where: { slug: formSlug }, select: { fields: true, published: true } }) : null;
  if (!dbForm || !dbForm.published) return NextResponse.json({ ok: false, error: "This form is not available." }, { status: 404 });
  const item = normaliseItems(dbForm.fields).find((i) => i.id === itemId && i.type === "file");
  if (!item) return NextResponse.json({ ok: false, error: "This form does not accept uploads here." }, { status: 400 });

  // (5) The field's own cap, never above ours - the page can claim anything.
  const limit = Math.min(MAX_BYTES, Math.max(1, item.maxSizeMb ?? 10) * 1024 * 1024);
  if (file.size > limit) {
    return NextResponse.json({ ok: false, error: `File is too large (max ${Math.floor(limit / 1024 / 1024)} MB)` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Re-check after reading: `file.size` is a claim until the bytes are in hand.
  if (buf.byteLength > limit) {
    return NextResponse.json({ ok: false, error: "File is too large" }, { status: 413 });
  }

  // (3) + (4)
  const kind = sniff(buf);
  if (!kind) {
    return NextResponse.json(
      { ok: false, error: "That file type isn't accepted. Send a PDF, Word document or image." },
      { status: 415 },
    );
  }

  // The stored name comes from OUR sniff, not the client's filename - the extension is part of a
  // URL path, and a filename is attacker-controlled.
  const key = `form-uploads/${buildStorageKey(`upload.${kind.ext}`, randomBytes(8).toString("hex"), new Date())}`;
  const up = await uploadObject(cfg, key, buf, kind.mime);
  if (!up.ok) return NextResponse.json({ ok: false, error: up.error }, { status: 502 });

  return NextResponse.json({ ok: true, url: publicUrl(cfg, key), name: file.name.slice(0, 120) });
}
