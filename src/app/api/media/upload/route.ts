import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/prisma";
import { capabilityCheck } from "@/lib/rbac";
import { buildStorageKey, publicUrl, storageConfig, uploadObject } from "@/lib/supabase-storage";

/**
 * Media-library upload.
 *
 * A route handler rather than a server action because server actions cannot stream a file body —
 * the whole payload would be serialised into the action argument.
 *
 * Session-gated on `sites.manage`. That matters more than it looks: an unauthenticated upload
 * endpoint writing to a PUBLIC bucket is free anonymous file hosting on the company's domain, and
 * it will be found.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 12 MB. A hero photo is under 3; anything past this is an unprocessed camera dump. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * What we accept. An allow-list of RASTER formats plus SVG's deliberate exclusion:
 * SVG is a script-bearing document, and serving one from our own origin on a public bucket is a
 * stored-XSS primitive. GHL allows it; that is not a reason to.
 */
const ALLOWED = new Map<string, string>([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
]);

export async function POST(req: NextRequest) {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return NextResponse.json(denied, { status: 403 });

  const cfg = storageConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "Media storage is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read the upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File is too large (max 12 MB)" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Identify by CONTENT, never by filename or the browser-supplied Content-Type. Both are
  // attacker-controlled; sharp reads the actual header. This is also what rejects a renamed
  // executable and a disguised SVG in one step.
  let meta: Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return NextResponse.json({ ok: false, error: "That file is not a readable image" }, { status: 415 });
  }

  const contentType = meta.format ? ALLOWED.get(meta.format) : undefined;
  if (!contentType) {
    return NextResponse.json(
      { ok: false, error: `Unsupported image type${meta.format ? ` (${meta.format})` : ""} — use JPEG, PNG, WebP, GIF or AVIF` },
      { status: 415 },
    );
  }

  const storageKey = buildStorageKey(file.name || "image", randomBytes(6).toString("hex"), new Date());

  // The ORIGINAL bytes are stored, unmodified. Deliberate: next/image derives every delivered
  // variant (WebP, five widths) at request time, exactly as GHL's transform CDN does over its own
  // origin. Re-encoding here would degrade the master copy to buy nothing.
  const up = await uploadObject(cfg, storageKey, buf, contentType);
  if (!up.ok) return NextResponse.json({ ok: false, error: up.error }, { status: 502 });

  const asset = await prisma.mediaAsset.create({
    data: {
      storageKey,
      url: publicUrl(cfg, storageKey),
      filename: (file.name || "image").slice(0, 200),
      mimeType: contentType,
      bytes: buf.length,
      // Captured now so the renderer can reserve space and avoid layout shift without measuring
      // the image at request time.
      width: meta.width ?? null,
      height: meta.height ?? null,
      uploadedById: session.user.id,
    },
    select: { id: true, url: true, filename: true, width: true, height: true, bytes: true },
  });

  return NextResponse.json({ ok: true, asset });
}
