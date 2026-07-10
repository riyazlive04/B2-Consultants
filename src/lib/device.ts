/**
 * Signing-device capture — isomorphic. NO prisma, NO server-only, NO secrets.
 *
 * THE DISTINCTION THAT MATTERS, and the reason this file separates `reported` from `observed`:
 *
 *   `reported`  comes from the signer's browser. It is a claim. Every field can be spoofed by
 *               anyone willing to open devtools, so it is stored, displayed and printed as
 *               "reported by the device" and NEVER presented as fact.
 *   `capture`   is how the signature was physically drawn — stroke count, duration, whether a
 *               stylus reported pressure. Also a claim, but a laborious one to fake convincingly,
 *               and it is what distinguishes a real hand from a pasted PNG.
 *   `observed`  is set by our server from the request itself: the IP and the User-Agent header.
 *               This is the only part a disputing counterparty cannot rewrite.
 *
 * `userAgentMismatch` compares the two user agents. A signer whose browser reports one UA while
 * the request header carries another is not necessarily fraudulent — but a certificate that
 * silently hides the discrepancy is worth less than one that prints it.
 */

import { z } from "zod";

// ───────────────────────────── Schema ─────────────────────────────

const size = z.object({
  w: z.number().int().min(0).max(30_000),
  h: z.number().int().min(0).max(30_000),
});

/** Everything the browser volunteers. Clamped hard: this lands in a legal document. */
export const reportedDeviceSchema = z.object({
  userAgent: z.string().trim().max(400).default(""),
  platform: z.string().trim().max(80).default(""),
  language: z.string().trim().max(40).default(""),
  timeZone: z.string().trim().max(60).default(""),
  timeZoneOffsetMinutes: z.number().int().min(-900).max(900).default(0),
  screen: size,
  viewport: size,
  devicePixelRatio: z.number().min(0).max(10),
  maxTouchPoints: z.number().int().min(0).max(64).default(0),
  orientation: z.string().trim().max(40).default(""),
});

/** How the signature was actually drawn. */
export const captureMetaSchema = z.object({
  pointerType: z.enum(["mouse", "pen", "touch", "unknown"]),
  strokeCount: z.number().int().min(0).max(2000),
  pointCount: z.number().int().min(0).max(500_000),
  durationMs: z.number().int().min(0).max(3_600_000),
  /** CSS pixels of the pad the signature was drawn on. */
  padSize: size,
  /** CSS-pixel bounding box of the ink itself. */
  inkBox: size,
  /** True when at least one sample carried a real pressure reading (a stylus, not a finger). */
  pressureObserved: z.boolean(),
  fullScreen: z.boolean().default(false),
});

/** What the client sends. The server appends `observed` — clients never supply it. */
export const signingDeviceSchema = z.object({
  reported: reportedDeviceSchema,
  capture: captureMetaSchema,
});

export const observedSchema = z.object({
  ip: z.string().max(64).nullable(),
  userAgent: z.string().max(400).nullable(),
  at: z.string(),
});

export type ReportedDevice = z.infer<typeof reportedDeviceSchema>;
export type CaptureMeta = z.infer<typeof captureMetaSchema>;
export type SigningDevice = z.infer<typeof signingDeviceSchema>;
export type Observed = z.infer<typeof observedSchema>;
export type StoredDevice = SigningDevice & { observed: Observed };

/** The full stored record, re-validated on read — a Json column is not a type. */
export const storedDeviceSchema = signingDeviceSchema.extend({ observed: observedSchema });

// ───────────────────────────── Client collection ─────────────────────────────

/**
 * Read what this browser will tell us. Returns null off the browser, and never throws:
 * a device that refuses to answer must still be able to sign.
 */
export function collectReportedDevice(): ReportedDevice | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const round = (n: number) => Math.max(0, Math.min(30_000, Math.round(n || 0)));
  return {
    userAgent: safe(() => navigator.userAgent, "").slice(0, 400),
    // `navigator.platform` is deprecated but still the only thing that distinguishes an iPad
    // from a Mac, since iPadOS lies about its user agent.
    platform: safe(() => navigator.platform ?? "", "").slice(0, 80),
    language: safe(() => navigator.language, "").slice(0, 40),
    timeZone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, "").slice(0, 60),
    timeZoneOffsetMinutes: safe(() => -new Date().getTimezoneOffset(), 0),
    screen: { w: round(safe(() => window.screen.width, 0)), h: round(safe(() => window.screen.height, 0)) },
    viewport: { w: round(window.innerWidth), h: round(window.innerHeight) },
    // Two decimals. A real phone reports 3.00000011920929, and a certificate that prints
    // "at 3.00000011920929x" reads like a bug rather than a legal record.
    devicePixelRatio: Math.round(Math.min(10, Math.max(0, safe(() => window.devicePixelRatio, 1))) * 100) / 100,
    maxTouchPoints: Math.min(64, Math.max(0, safe(() => navigator.maxTouchPoints ?? 0, 0))),
    orientation: safe(() => screen.orientation?.type ?? "", "").slice(0, 40),
  };
}

// ───────────────────────────── Description ─────────────────────────────

/**
 * Phone / Tablet / Laptop or desktop.
 *
 * Touch capability is the primary signal, screen size the tie-break. iPadOS reports a Mac user
 * agent, so `platform === "MacIntel"` with touch points is the documented iPad tell — a
 * desktop Mac has none.
 */
export function deviceKind(d: ReportedDevice): "Phone" | "Tablet" | "Laptop or desktop" {
  const touch = d.maxTouchPoints > 0;
  const shortEdge = Math.min(d.screen.w || 0, d.screen.h || 0);
  if (!touch) return "Laptop or desktop";
  if (/ipad/i.test(d.userAgent) || (d.platform === "MacIntel" && d.maxTouchPoints > 1)) return "Tablet";
  if (shortEdge >= 700) return "Tablet";
  return "Phone";
}

export function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

export function osOf(d: ReportedDevice): string {
  const ua = d.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPod/i.test(ua)) return "iOS";
  if (/iPad/i.test(ua) || (d.platform === "MacIntel" && d.maxTouchPoints > 1)) return "iPadOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

const INPUT_LABEL: Record<CaptureMeta["pointerType"], string> = {
  touch: "a finger",
  pen: "a stylus",
  mouse: "a mouse or trackpad",
  unknown: "an unknown input",
};

/** "Phone · Chrome on Android · signed with a finger" */
export function describeDevice(d: SigningDevice): string {
  const kind = deviceKind(d.reported);
  const browser = browserOf(d.reported.userAgent);
  const os = osOf(d.reported);
  return `${kind} · ${browser} on ${os} · signed with ${INPUT_LABEL[d.capture.pointerType]}`;
}

/** "3", "2.75" — never "3.00000011920929". */
export function formatDpr(dpr: number): string {
  if (!Number.isFinite(dpr) || dpr <= 0) return "1";
  return String(Math.round(dpr * 100) / 100);
}

/** Human seconds: 6.2s, 1m 04s. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** True when the browser's self-reported UA disagrees with the request header we observed. */
export function userAgentMismatch(d: StoredDevice): boolean {
  const a = d.reported.userAgent.trim();
  const b = (d.observed.userAgent ?? "").trim();
  return !!a && !!b && a !== b;
}

/**
 * Label/value rows for the certificate page and the dashboard panel. Ordered most- to
 * least-load-bearing, and honest about which half is a claim.
 */
export function deviceRows(d: StoredDevice): Array<[string, string]> {
  const r = d.reported;
  const c = d.capture;
  const offset = r.timeZoneOffsetMinutes;
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const tz = r.timeZone
    ? `${r.timeZone} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")})`
    : "not reported";

  return [
    ["Device", deviceKind(r)],
    ["Browser", `${browserOf(r.userAgent)} on ${osOf(r)}`],
    ["Input", INPUT_LABEL[c.pointerType] + (c.pressureObserved ? " (pressure-sensitive)" : "")],
    // Format the DPR here too, not just at collection: rows written before this was rounded, and
    // any client willing to POST its own payload, can still carry a 15-decimal float.
    ["Screen", r.screen.w ? `${r.screen.w} x ${r.screen.h} at ${formatDpr(r.devicePixelRatio)}x` : "not reported"],
    ["Time zone", tz],
    ["Language", r.language || "not reported"],
    [
      "Drawing",
      `${c.strokeCount} stroke${c.strokeCount === 1 ? "" : "s"}, ${c.pointCount} points, ${formatDuration(
        c.durationMs,
      )}${c.fullScreen ? ", full screen" : ""}`,
    ],
    ["Signed from IP", d.observed.ip ?? "not recorded"],
  ];
}
