/**
 * Error tracking — the Sentry seam.
 *
 * WHY THIS EXISTS: until now a production error reached the founders only when a client emailed.
 * Every `catch` in this codebase either swallows the error or writes it into a JSON blob nobody
 * reads (`daily-maintenance.safe()` is the clearest example — a failed sub-job stores its message
 * in the cron response and that response goes nowhere).
 *
 * WHY NOT `@sentry/nextjs`: this file follows the seam already established by lib/anthropic.ts and
 * lib/email.ts — raw HTTP to the vendor, keys-off by default, never throws into a request path. The
 * SDK would add a webpack plugin and an auto-instrumentation layer that rewrites the Next build, to
 * do a job that is one POST of one JSON envelope. The envelope endpoint is a stable, documented
 * HTTP API; the build risk of the SDK is not worth taking on an app that is already fragile to
 * build (see the `.next` dist-dir notes in README).
 *
 * DELIBERATELY NOT `server-only`: `app/(app)/error.tsx` is a client component, and the local ring
 * buffer / DSN-armed check are useful on both sides. The *send* path is guarded by `isServer`
 * anyway — a browser POST to Sentry would need a different (public) DSN and CORS setup, so client
 * errors travel over `/api/observability/client-error` instead and are captured server-side.
 */

// ─────────────────────────────── DSN ───────────────────────────────

export type ParsedDsn = { origin: string; projectId: string; publicKey: string };

/**
 * Sentry DSNs look like `https://<publicKey>@o123.ingest.sentry.io/<projectId>`.
 *
 * Returns null rather than throwing for ANY malformed value. A typo'd DSN must degrade to
 * "error tracking is off", never to a boot failure — the whole point of this module is to be the
 * thing that still works when other things are broken.
 */
export function parseDsn(raw: string | undefined | null): ParsedDsn | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "").split("/").pop() ?? "";
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
    return { origin: `${url.protocol}//${url.host}`, projectId, publicKey };
  } catch {
    return null;
  }
}

// ─────────────────────────────── scrubbing ───────────────────────────────

/**
 * Context keys whose VALUE is never sent, whatever it contains. Matched case-insensitively on a
 * substring, so `dbPassword`, `WATI_ACCESS_TOKEN` and `authorization` all hit.
 */
const DENY_KEY_PARTS = [
  "password", "passwd", "secret", "token", "authorization", "auth", "apikey", "api_key",
  "cookie", "session", "dsn", "connectionstring", "database_url", "credential", "signature",
];

/**
 * Value patterns scrubbed out of free text (messages, stack frames, breadcrumb strings).
 *
 * This is not paranoia. This app puts connection strings into error messages by default — a Prisma
 * connection failure embeds the full `postgres://user:password@host/db`, and that error is exactly
 * the kind most worth reporting. Shipping the production database password to a third-party SaaS in
 * order to find out the database was unreachable would be a strictly worse outcome than the
 * blindness this module is meant to fix.
 */
const VALUE_PATTERNS: { re: RegExp; with: string }[] = [
  { re: /postgres(?:ql)?:\/\/[^\s"']+/gi, with: "postgres://[redacted]" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, with: "Bearer [redacted]" },
  { re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, with: "[redacted-key]" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, with: "[redacted-jwt]" },
  // Long opaque runs — WATI tokens, Resend keys, raw hex secrets. 32+ chars of unbroken
  // key-shaped text in an error message is far more likely a credential than a sentence.
  { re: /\b[A-Fa-f0-9]{32,}\b/g, with: "[redacted-hex]" },
];

/** Strips credential-shaped substrings out of free text. Always returns a string. */
export function scrubText(input: string): string {
  let out = input;
  for (const p of VALUE_PATTERNS) out = out.replace(p.re, p.with);
  return out;
}

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_PARTS.some((part) => k.includes(part));
}

/**
 * Scrubs a context bag: denied keys are replaced wholesale, surviving strings are swept for
 * credential patterns, and the whole thing is depth- and size-limited so a giant Prisma payload
 * can't be smuggled into an event.
 */
export function scrubContext(input: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return scrubText(input.length > 2000 ? `${input.slice(0, 2000)}…` : input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (typeof input === "bigint") return input.toString();
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => scrubContext(v, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 50)) {
      out[k] = isDeniedKey(k) ? "[redacted]" : scrubContext(v, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}

// ─────────────────────────────── local mirror ───────────────────────────────

export type LocalError = {
  at: string;
  level: "error" | "warning";
  message: string;
  where: string | null;
  sent: boolean;
};

/**
 * In-process ring buffer of the last errors, kept REGARDLESS of whether Sentry is armed.
 *
 * This is the half that works on day one, before anyone has signed up for anything: the Founder
 * Console reads it, so "did something break today" has an answer inside the app. It is per-process
 * and lost on restart, which is exactly why it is a complement to Sentry and not a replacement.
 */
const RING_SIZE = 50;
const ring: LocalError[] = [];
let totalErrors = 0;
const hourlyBuckets = new Map<number, number>();

function recordLocal(entry: LocalError) {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  totalErrors += 1;
  const hour = Math.floor(Date.now() / 3_600_000);
  hourlyBuckets.set(hour, (hourlyBuckets.get(hour) ?? 0) + 1);
  for (const h of hourlyBuckets.keys()) if (h < hour - 24) hourlyBuckets.delete(h);
}

export function recentErrors(): LocalError[] {
  return [...ring].reverse();
}

export function errorCountLastHour(): number {
  return hourlyBuckets.get(Math.floor(Date.now() / 3_600_000)) ?? 0;
}

export function errorCountTotal(): number {
  return totalErrors;
}

// ─────────────────────────────── circuit breaker ───────────────────────────────

/**
 * At most 30 events per minute leave this process.
 *
 * A crash loop is the case where error tracking matters most and also the case where it can do the
 * most harm: an unhandled rejection inside a hot path can produce thousands of identical events a
 * minute, burn the Sentry quota that the ONE interesting error later in the day needed, and add
 * outbound latency to a process already in trouble. The 31st copy of an error is not information.
 */
const SEND_LIMIT_PER_MIN = 30;
let sendWindowStart = 0;
let sendsInWindow = 0;

function maySend(now: number): boolean {
  if (now - sendWindowStart >= 60_000) {
    sendWindowStart = now;
    sendsInWindow = 0;
  }
  if (sendsInWindow >= SEND_LIMIT_PER_MIN) return false;
  sendsInWindow += 1;
  return true;
}

// ─────────────────────────────── runtime ───────────────────────────────

export type ObservabilityRuntime = {
  armed: boolean;
  environment: string;
  release: string | null;
};

export function observabilityRuntime(): ObservabilityRuntime {
  return {
    armed: parseDsn(process.env.SENTRY_DSN) !== null,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE?.trim() || null,
  };
}

export type CaptureContext = {
  /** Where this came from — "cron:daily", "webhook:wati", "action:submitBooking". */
  where?: string;
  level?: "error" | "warning";
  /** Free-form extras. Scrubbed before send; credential-shaped keys are dropped entirely. */
  extra?: Record<string, unknown>;
  /** Grouping hint. Sentry buckets by this when present, instead of by stack shape. */
  fingerprint?: string[];
};

const isServer = typeof window === "undefined";

function eventPayload(
  err: unknown,
  ctx: CaptureContext,
  rt: ObservabilityRuntime,
): Record<string, unknown> {
  const error = err instanceof Error ? err : null;
  const rawMessage = error ? error.message : typeof err === "string" ? err : JSON.stringify(err);
  const message = scrubText(String(rawMessage ?? "Unknown error")).slice(0, 1000);

  return {
    event_id: cryptoRandomHex(),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: ctx.level ?? "error",
    environment: rt.environment,
    ...(rt.release ? { release: rt.release } : {}),
    logger: ctx.where ?? "app",
    ...(ctx.fingerprint ? { fingerprint: ctx.fingerprint } : {}),
    tags: { where: ctx.where ?? "unknown" },
    extra: scrubContext(ctx.extra ?? {}) as Record<string, unknown>,
    exception: {
      values: [
        {
          type: error?.name ?? "Error",
          value: message,
          stacktrace: error?.stack
            ? { frames: parseStack(error.stack) }
            : undefined,
        },
      ],
    },
  };
}

/** 32 hex chars — Sentry's event_id format. Uses Web Crypto, present in both runtimes. */
function cryptoRandomHex(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Coarse stack parse — enough for Sentry to render a readable trace without pulling in a
 * source-map library. Frames arrive innermost-first from V8 and Sentry wants outermost-first.
 */
function parseStack(stack: string): { filename: string; function: string; lineno?: number }[] {
  return stack
    .split("\n")
    .slice(1, 31)
    .map((line) => {
      const m = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!m) return { filename: scrubText(line.trim()).slice(0, 300), function: "?" };
      return {
        function: m[1] ?? "?",
        filename: scrubText(m[2] ?? "").slice(0, 300),
        lineno: Number(m[3]) || undefined,
      };
    })
    .reverse();
}

/**
 * Sends one event to Sentry's envelope endpoint. Resolves `false` for every failure mode —
 * unarmed, rate-limited, network error, non-2xx — and NEVER throws.
 *
 * Not exported: callers use `captureException`, which also handles the local mirror.
 */
async function sendEnvelope(event: Record<string, unknown>, dsn: ParsedDsn): Promise<boolean> {
  const body =
    `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n` +
    `${JSON.stringify({ type: "event" })}\n` +
    `${JSON.stringify(event)}\n`;

  try {
    const res = await fetch(`${dsn.origin}/api/${dsn.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=b2-raw/1.0, sentry_key=${dsn.publicKey}`,
      },
      body,
      // A reporting call must never become the reason a request is slow. 3s and give up.
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * THE entry point. Records locally always; ships to Sentry when armed.
 *
 * Returns a promise you are welcome to ignore — and mostly should. Callers in request paths should
 * NOT await this: the user's response must not wait on a third-party POST. Callers in cron jobs may
 * await it, because there is nobody waiting and losing the report to process exit would be worse.
 */
export async function captureException(err: unknown, ctx: CaptureContext = {}): Promise<boolean> {
  const rt = observabilityRuntime();
  const dsn = parseDsn(process.env.SENTRY_DSN);
  const message = err instanceof Error ? err.message : String(err);

  const willSend = Boolean(dsn) && isServer && maySend(Date.now());

  recordLocal({
    at: new Date().toISOString(),
    level: ctx.level ?? "error",
    message: scrubText(message).slice(0, 500),
    where: ctx.where ?? null,
    sent: willSend,
  });

  // Console remains the ground truth in `docker compose logs`. Sentry is an addition to it,
  // never a replacement — a log line costs nothing and survives an unreachable Sentry.
  // eslint-disable-next-line no-console
  console.error(`[${ctx.where ?? "app"}]`, scrubText(message));

  if (!willSend || !dsn) return false;
  return sendEnvelope(eventPayload(err, ctx, rt), dsn);
}

/** Same seam for a non-exception condition worth knowing about ("cron hasn't run in 6 hours"). */
export async function captureMessage(msg: string, ctx: CaptureContext = {}): Promise<boolean> {
  return captureException(new Error(msg), { level: "warning", ...ctx });
}

/**
 * Wraps an async job so a throw is reported and then re-thrown unchanged.
 *
 * The re-throw is deliberate: this is an observer, not a error-handling strategy. A caller that
 * wants to swallow the error should still say so itself, at its own call site, where the reader
 * can see it.
 */
export async function observed<T>(where: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await captureException(err, { where });
    throw err;
  }
}
