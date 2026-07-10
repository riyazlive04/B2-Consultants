/**
 * German Note class recordings are pasted links, never uploads (no storage
 * infra by design). Classes are recorded by fathom.ai, so the Fathom share
 * link is the primary provider; YouTube/Vimeo/Drive also accepted. This
 * parses each provider into a safe iframe src; anything else is rejected at
 * the action layer. Isomorphic — the client reuses it for paste-preview.
 */

export type GnVideoProviderKey = "FATHOM" | "YOUTUBE" | "VIMEO" | "GDRIVE";

export type ParsedVideo = { provider: GnVideoProviderKey; embedUrl: string };

const YT_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "youtube-nocookie.com", "www.youtube-nocookie.com",
]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,12}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{20,80}$/;
const FATHOM_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export const VIDEO_PROVIDER_LABELS: Record<GnVideoProviderKey, string> = {
  FATHOM: "Fathom",
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
  GDRIVE: "Google Drive",
};

/** Returns null unless the URL is a recognisable YouTube / Vimeo / Drive video link. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split("/").filter(Boolean);

  // ── Fathom (fathom.ai class recordings): fathom.video/share/<token> ──
  // The share token doubles as the embed id (fathom.video/embed/<token>,
  // per Fathom's Iframely/Embedly integration). /calls/<id> links are the
  // tutor's PRIVATE view and won't play for students → rejected on purpose;
  // only "Copy share link" URLs work.
  if (host === "fathom.video" || host === "www.fathom.video") {
    if (path[0] !== "share" && path[0] !== "embed") return null;
    const token = path[1];
    if (!token || !FATHOM_TOKEN.test(token)) return null;
    return { provider: "FATHOM", embedUrl: `https://fathom.video/embed/${token}?autoplay=0` };
  }

  // ── YouTube: watch?v= / youtu.be/<id> / live|shorts|embed/<id> ──
  if (host === "youtu.be" || YT_HOSTS.has(host)) {
    let id: string | undefined;
    if (host === "youtu.be") id = path[0];
    else if (path[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (["live", "shorts", "embed"].includes(path[0] ?? "")) id = path[1];
    if (!id || !YT_ID.test(id)) return null;
    // nocookie embed works for unlisted videos too
    return { provider: "YOUTUBE", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }

  // ── Vimeo: vimeo.com/<id>[/<hash>] / player.vimeo.com/video/<id>?h=<hash> ──
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    let id: string | undefined;
    let hash: string | undefined;
    if (host === "player.vimeo.com") {
      if (path[0] !== "video") return null;
      id = path[1];
      hash = url.searchParams.get("h") ?? undefined;
    } else {
      id = path[0];
      hash = path[1];
    }
    if (!id || !VIMEO_ID.test(id)) return null;
    if (hash && !VIMEO_HASH.test(hash)) hash = undefined;
    // the ?h= hash is what makes unlisted videos playable — keep it
    const suffix = hash ? `?h=${hash}` : "";
    return { provider: "VIMEO", embedUrl: `https://player.vimeo.com/video/${id}${suffix}` };
  }

  // ── Google Drive: /file/d/<id>/… or /open?id=<id> (file must be link-shared) ──
  if (host === "drive.google.com") {
    let id: string | undefined;
    if (path[0] === "file" && path[1] === "d") id = path[2];
    else if (path[0] === "open" || path[0] === "uc") id = url.searchParams.get("id") ?? undefined;
    if (!id || !DRIVE_ID.test(id)) return null;
    return { provider: "GDRIVE", embedUrl: `https://drive.google.com/file/d/${id}/preview` };
  }

  return null;
}
