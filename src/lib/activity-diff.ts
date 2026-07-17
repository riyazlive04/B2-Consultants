/**
 * Field-level diff for activity-log update entries — pure, so it lives here rather than in
 * server/activity-log.ts (which imports prisma and `server-only`) and can be unit-tested.
 *
 * Call sites import it from `server/activity-log`, which re-exports it.
 */

export type FieldDiff = {
  /** Names of the fields that actually moved. Empty ⇒ nothing happened; skip the log. */
  changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/**
 * Compare only the keys present in `after`, so a caller can diff the handful of fields a
 * form touches without listing everything the row holds.
 *
 * The founder should see "changed Stage and Owner", not a wall of unchanged values — and an
 * update that changed nothing shouldn't reach the feed at all.
 */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): FieldDiff {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = normalise(before[key]);
    const next = normalise(after[key]);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      changed.push(key);
      b[key] = prev;
      a[key] = next;
    }
  }
  return { changed, before: b, after: a };
}

/**
 * Collapse a value to something JSON can compare honestly.
 *
 * Three cases, each a way a money edit could go unrecorded:
 *
 * - **BigInt** — every amount in this app is a BigInt minor unit, and `JSON.stringify` THROWS
 *   on one rather than returning anything. Because callers run `diffFields` before handing the
 *   result to `logActivity`, that throw would escape the helper's try/catch and roll back the
 *   caller's real write. A log that can delete a payment is far worse than no log.
 * - **Decimal** — a Prisma Decimal serialises to `{}`, so every amount would compare equal to
 *   every other, and a corrected fee would log as "nothing changed": the precise edit the
 *   founder most wants to see, silently swallowed.
 * - **Date** — compared by instant, so a rescheduled date reads as a change and an identical
 *   one doesn't.
 */
function normalise(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toFixed" in v && typeof (v as { toFixed: unknown }).toFixed === "function") {
    return String(v);
  }
  return v ?? null;
}

/**
 * Deep-clean a value for the `meta` JSON column, for the same reason as above: one BigInt
 * anywhere in the object makes the whole write throw. Here the throw happens INSIDE
 * `logActivity`, so it's caught — which is worse in its own way, because the entry is then
 * lost silently and the founder sees a gap rather than an error.
 *
 * Applied centrally so no call site has to remember to stringify its own amounts.
 */
export function sanitiseMeta(v: unknown, depth = 0): unknown {
  if (depth > 8) return "[nested too deep]"; // cycles can't survive JSON anyway; don't hang on them
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => sanitiseMeta(x, depth + 1));
  if ("toFixed" in v && typeof (v as { toFixed: unknown }).toFixed === "function") return String(v);
  if (Buffer.isBuffer(v)) return `[${v.byteLength} bytes]`; // a sealed PDF must never land in the log
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = sanitiseMeta(val, depth + 1);
  return out;
}
