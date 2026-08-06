import "server-only";

/**
 * Supabase Storage — the media origin for the marketing site.
 *
 * ── Why raw fetch and not @supabase/supabase-js ───────────────────────────────────────────────
 * We use exactly three endpoints (upload, delete, public URL) and none of the SDK's session,
 * realtime or PostgREST machinery. The observability layer already sets this precedent: it talks
 * to Sentry's envelope endpoint over plain HTTP with no SDK and no build-time dependency.
 *
 * ── The key, and why this file is the only place it may appear ────────────────────────────────
 * `.env.supabase.example` says, correctly, that the app needs NO Supabase API keys: it reaches
 * Postgres over the wire protocol via Prisma, and `scripts/supabase-lockdown.sql` revoked `anon`
 * and `authenticated` so their keys read nothing. This file is the first exception, and it uses
 * `service_role`, which is BYPASSRLS.
 *
 * That is a real escalation, so it is worth being precise about what it does and does not change:
 *   · Env-var compromise: NOT materially worse. DATABASE_URL already grants full database access,
 *     so an attacker who can read the app's environment has that regardless.
 *   · Browser exposure: CATASTROPHIC, and the actual thing to defend. This module is `server-only`
 *     and the key must never appear in a NEXT_PUBLIC_* var, a client component, or a response body.
 *
 * Reads need no key at all: the bucket is public, which is what lets next/image fetch and cache
 * variants without credentials.
 */

export type StorageConfig = { url: string; key: string; bucket: string };

/**
 * Returns null when unconfigured rather than throwing, so every caller must decide what to do —
 * and the upload route can answer with a clear 503 instead of a stack trace. Same fail-closed
 * contract as the WATI and lead-webhook seams.
 */
export function storageConfig(): StorageConfig | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || "site-media" };
}

/** The public URL of a stored object. No credentials — the bucket is public-read by design. */
export function publicUrl(cfg: StorageConfig, storageKey: string): string {
  return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${storageKey}`;
}

/**
 * Upload bytes. `upsert` is deliberately OFF: keys carry a random suffix, so a collision means a
 * bug, and silently overwriting someone else's image is far worse than failing loudly.
 */
export async function uploadObject(
  cfg: StorageConfig,
  storageKey: string,
  body: Buffer,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${storageKey}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.key}`,
      "content-type": contentType,
      // A year, immutable: the key is unique per upload, so the bytes at a given URL never change.
      // This is what lets Cloudflare and next/image cache hard instead of revalidating.
      "cache-control": "public, max-age=31536000, immutable",
      "x-upsert": "false",
    },
    body: new Uint8Array(body),
  });
  if (res.ok) return { ok: true };
  // Surface Supabase's own message — "Bucket not found" and "invalid JWT" are the two failures
  // that actually happen on first setup, and both are unrecognisable as a bare status code.
  const detail = await res.text().catch(() => "");
  return { ok: false, error: `Storage upload failed (${res.status}): ${detail.slice(0, 300)}` };
}

export async function deleteObject(cfg: StorageConfig, storageKey: string): Promise<boolean> {
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${storageKey}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${cfg.key}` },
  });
  return res.ok;
}

/**
 * Build the object key.
 *
 * Date-prefixed so the bucket stays browsable by hand, and suffixed with randomness so two people
 * uploading `logo.png` in the same minute do not collide. The original filename is kept in the
 * MediaAsset row for display — it is NOT trusted here, because a filename is attacker-controlled
 * and this string becomes a URL path.
 */
export function buildStorageKey(filename: string, random: string, now: Date): string {
  const ext = (filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "bin").toLowerCase();
  const stem = filename
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "file";
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${yyyymm}/${stem}-${random}.${ext}`;
}
