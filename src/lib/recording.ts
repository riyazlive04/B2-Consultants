/**
 * RECORDINGS ON AN IMPROVEMENT REPORT - the whole contract, in one isomorphic file.
 *
 * Pure, no prisma, no `server-only`, for the same reason `lib/improvement.ts` is: the recorder
 * (client) decides what to capture from this file and the upload route (server) decides what to
 * accept from the very same constants. A recorder that produces a 30 MB file and a route that
 * refuses 25 MB is a feature that works on the developer's machine and fails for the person it
 * was built for.
 *
 * ── TWO KINDS, AND WHY BOTH EXIST ──────────────────────────────────────────────────────────
 *   AUDIO   the reporter talking. Small, works everywhere, including every phone.
 *   SCREEN  the reporter's screen WITH their voice over it - the clicks, the form, the error
 *           appearing. The strongest bug report this app can collect.
 *
 * SCREEN does not replace AUDIO, because `getDisplayMedia` **does not exist on iOS at all**.
 * Every student and half the team are on a phone, so removing the audio-only option would take
 * the feature away from the people most likely to hit a dead end.
 *
 * ── NOTHING IS TRANSCRIBED ─────────────────────────────────────────────────────────────────
 * Triage watches and listens. The cost is real and deliberate: a recording cannot be searched,
 * put in a title, emailed or carried in the daily digest, and cannot be skimmed. That is why it
 * is optional, capped, and never required for a report to be filed.
 *
 * ── WHERE THE BYTES LIVE ───────────────────────────────────────────────────────────────────
 * In Postgres, served by an authenticated route - the pattern `AgreementAttachment` already set
 * for private files. NOT in Supabase Storage: that bucket is public-read by design (it is the
 * marketing site's media origin), its credentials are not configured here, and a recording of
 * somebody walking through a student's payment schedule has no business behind a public URL.
 */

export const RECORDING_KINDS = ["AUDIO", "SCREEN"] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];

// ─────────────────────────────── caps ───────────────────────────────

/**
 * Per-kind caps. The recorder stops ITSELF at the limit rather than letting somebody talk for
 * five minutes and then refusing the upload, which would throw away the only thing they were
 * willing to give us.
 *
 * AUDIO - two minutes is long enough to describe a broken screen twice over, and ~400 KB.
 *
 * SCREEN - three minutes, because the whole point is that they walk through the problem, and a
 * flow with a login, two navigations and a failing save does not fit in two. 25 MB is sized from
 * the bitrate below: 800 kbit/s of video plus 64 kbit/s of audio is ~19 MB for the full three
 * minutes, so this is headroom and not a target. A screen recording of a UI is mostly static
 * pixels, which is why a low frame rate costs almost nothing in legibility - see
 * `SCREEN_VIDEO_CONSTRAINTS`.
 */
export const RECORDING_LIMITS: Record<RecordingKind, { seconds: number; bytes: number }> = {
  AUDIO: { seconds: 120, bytes: 2_000_000 },
  SCREEN: { seconds: 180, bytes: 25_000_000 },
};

/** The largest body the upload route will read, whatever the declared kind. */
export const RECORDING_MAX_BYTES = Math.max(
  ...Object.values(RECORDING_LIMITS).map((l) => l.bytes),
);

export const RECORDING_MAX_SECONDS = Math.max(
  ...Object.values(RECORDING_LIMITS).map((l) => l.seconds),
);

// ─────────────────────────────── containers and types ───────────────────────────────

/**
 * The containers a browser will hand us. Chrome and Edge give WebM, Safari gives MP4, Firefox
 * gives Ogg for audio. There is no one format every browser both records and plays, which is why
 * the stored mime type travels with the row instead of being assumed at playback.
 */
export const RECORDING_CONTAINERS = ["webm", "mp4", "ogg"] as const;
export type RecordingContainer = (typeof RECORDING_CONTAINERS)[number];

/**
 * The stored `Content-Type` for a container and kind.
 *
 * ── WHY THE KIND IS NOT SNIFFED ────────────────────────────────────────────────────────────
 * `audio/webm` and `video/webm` are **byte-identical in their header**: both are Matroska and
 * both start `1A 45 DF A3`. No magic-byte check can tell them apart without parsing the track
 * table, so the audio-or-video half comes from the client's declared kind.
 *
 * That is safe, and it is worth being precise about why. The security property this file exists
 * to hold is that a stored type is always drawn from THIS whitelist and never from the request's
 * `Content-Type` header - so an uploader cannot cause `text/html` to be served back from this
 * origin. Lying about the kind only picks a different safe media type: the worst outcome is a
 * `<video>` element showing a black rectangle with sound, which harms nobody.
 */
export function recordingMime(container: RecordingContainer, kind: RecordingKind): string | null {
  if (kind === "AUDIO") return `audio/${container}`;
  // Nothing records screen video into Ogg, so it is refused rather than stored as a type no
  // browser here will produce.
  if (container === "ogg") return null;
  return `video/${container}`;
}

/** Every type this app will store, which is also every type the serving route may emit. */
export const RECORDING_MIME_TYPES: readonly string[] = [
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "video/webm",
  "video/mp4",
];

export function isStorableMime(value: string): boolean {
  return RECORDING_MIME_TYPES.includes(value);
}

/** `video/webm;codecs=vp9,opus` -> `webm`. Null for anything not on the list. */
export function containerOf(contentType: string | null | undefined): RecordingContainer | null {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const sub = base.split("/")[1];
  return (RECORDING_CONTAINERS as readonly string[]).includes(sub)
    ? (sub as RecordingContainer)
    : null;
}

// ─────────────────────────────── what the recorder asks for ───────────────────────────────

/**
 * What `MediaRecorder` is asked for, best first. The codec suffix matters on the way IN - it is
 * how you ask Chrome for Opus or VP9 rather than its default - and is thrown away on the way out.
 */
export const RECORDER_PREFERENCES: Record<RecordingKind, readonly string[]> = {
  AUDIO: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"],
  SCREEN: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ],
};

/** 800 kbit/s video, 64 kbit/s voice. See the note on `RECORDING_LIMITS.SCREEN`. */
export const SCREEN_BITRATES = { videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 } as const;

/**
 * A UI is mostly static pixels, so 12 fps reads as a perfectly clear screen recording at a
 * fraction of the size, and capping the width keeps a 4K monitor from producing a file nobody can
 * upload. Legibility comes from resolution, not frame rate.
 */
export const SCREEN_VIDEO_CONSTRAINTS = {
  frameRate: { max: 12 },
  width: { max: 1600 },
} as const;

/**
 * THE CAPTURE IS PINNED TO THIS TAB.
 *
 * `preferCurrentTab` makes Chrome offer only the current tab in its picker, and
 * `monitorTypeSurfaces: "exclude"` removes "Entire Screen" where that is honoured. Between them
 * a reporter cannot hand us another application, another tab, their email or a bank page - which
 * matters because these files land in a table every triager can play back, and because somebody
 * concentrating on reproducing a bug is not also auditing what else is on their screen.
 *
 * `surfaceSwitching: "exclude"` stops them changing the shared surface mid-recording.
 *
 * These are Chrome-specific hints and are simply ignored elsewhere; they are a guard rail, not a
 * guarantee, which is why the UI also says what is being captured.
 */
export const SCREEN_CAPTURE_OPTIONS = {
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "exclude",
  monitorTypeSurfaces: "exclude",
} as const;

// ─────────────────────────────── the sniff ───────────────────────────────

/**
 * What the bytes ACTUALLY are, read from their own first bytes.
 *
 * The `Content-Type` on an upload is attacker-controlled - a header on a request anyone with a
 * session can craft - and the stored value becomes the `Content-Type` of a response the browser
 * is asked to render. Sniffing is the same decision `/api/form-upload` and the agreement
 * attachment route already made: a stored `text/html` served from this origin is a scripting
 * hole, and "the client said it was a video" prevents nothing.
 *
 * Returns the CONTAINER only - see `recordingMime` for why audio-vs-video cannot come from here.
 * Null when the magic matches none of the three, and the route turns that into a refusal. There
 * is no "probably fine" branch on purpose.
 */
export function sniffContainer(bytes: Uint8Array): RecordingContainer | null {
  // WebM / Matroska: the EBML header, 1A 45 DF A3. Audio-only and video WebM are identical here.
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  // Ogg: the capture pattern "OggS".
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return "ogg";
  }
  /**
   * MP4 / ISO-BMFF: "ftyp" at offset 4, after the box size. No brand check - the brand Safari
   * picks varies by version and by whether the clip was finalised, and the container is what is
   * being identified, not the profile.
   */
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "mp4";
  }
  return null;
}

// ─────────────────────────────── display ───────────────────────────────

/** `0:14`, `1:07`, `3:00`. "74 seconds" tells a reader nothing about whether to press play. */
export function formatClipLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Clamp a client-reported duration into the stored range for its kind.
 *
 * The length is measured by the recorder's own timer and is therefore client-supplied. It is
 * cosmetic - it decides what the queue chip and the player label read - and NOTHING is authorised
 * or sized from it, so clamping is the whole defence it needs. The bytes are checked properly.
 */
export function clampClipSeconds(value: unknown, kind: RecordingKind): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(RECORDING_LIMITS[kind].seconds, Math.round(n));
}

export function parseRecordingKind(value: unknown): RecordingKind | null {
  return (RECORDING_KINDS as readonly string[]).includes(value as string)
    ? (value as RecordingKind)
    : null;
}

/** The filename a download gets. `IMP-0042-screen.webm` beats a cuid in a Downloads folder. */
export function recordingFilename(ref: string, mime: string, kind: RecordingKind): string {
  const container = containerOf(mime) ?? "webm";
  const ext = container === "mp4" ? (kind === "AUDIO" ? "m4a" : "mp4") : container;
  const safe = ref.replace(/[^A-Za-z0-9_-]/g, "") || "improvement";
  return `${safe}-${kind === "SCREEN" ? "screen" : "voice"}.${ext}`;
}

/** What the queue chip and the triage label call it. */
export const RECORDING_LABEL: Record<RecordingKind, string> = {
  AUDIO: "Voice note",
  SCREEN: "Screen recording",
};
