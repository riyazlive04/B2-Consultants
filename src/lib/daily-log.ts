/**
 * Daily Log — the layer that turns a row of raw numbers into a readable activity entry.
 *
 * A stored log is just per-variant integers (6 calls, 2 highly qualified, …). The timeline
 * needs each entry to *say* something: what happened, whether it was a good day, and why.
 * These helpers do exactly that, and NOTHING else — no I/O, no zod, no React — so both the
 * server (deriving entries for a page) and the client (re-deriving nothing, just typing
 * against the shape) can import them without dragging server-only code into the browser.
 *
 * Status is graded against a reference: the founder's daily target if one is set, otherwise
 * the person's own recent median. That way it works the day the feature ships and only gets
 * sharper once targets are configured in the Console.
 */

import { DAILY_LOG_FIELDS, LOG_FIELD_SHORT, LOG_FIELD_UNIT, LOG_VARIANT_LABEL } from "./labels";

export type LogVariant = "DISCOVERY_SPECIALIST" | "APPOINTMENT_SETTER" | "DELIVERY_COACH";

/** The status tones map onto the app's semantic Pill tones (kit.tsx). */
export type StatusTone = "good" | "warn" | "bad" | "info" | "neutral" | "primary";

/** Filterable status buckets. `logged` = recorded, not enough history to grade yet. */
export type LogStatusKey = "standout" | "ontarget" | "belowpar" | "quiet" | "logged";

export type LogStatus = {
  key: LogStatusKey;
  label: string;
  tone: StatusTone;
  /** One line of "why it matters" — the comparison that produced this status. */
  context: string;
};

export type LogMetric = {
  key: string;
  value: number;
  /** Human unit, e.g. "calls", "highly qualified". */
  unit: string;
  /** Terse label for tight layouts / CSV. */
  short: string;
  /** Auto-captured from real activity rather than hand-typed. */
  auto: boolean;
  /** The headline metric for the variant — the one the status is graded on. */
  primary: boolean;
  /** Directional emphasis for the primary metric only. */
  emphasis?: "up" | "down";
};

export type PersonRef = { name: string; initials: string; role: string };

export type LogEntry = {
  id: string;
  /** UTC-midnight ISO of the log day (@db.Date encoding). */
  date: string;
  /** Whole days between this log and today (0 = today). Drives the timeline buckets. */
  relDays: number;
  /** Short absolute label, e.g. "Thu 17 Jul". */
  dateLabel: string;
  /** Time the entry was submitted, e.g. "6:12 PM" (IST), or null for legacy rows. */
  submittedTimeLabel: string | null;
  bucketKey: string;
  bucketLabel: string;
  variant: LogVariant;
  person: PersonRef | null;
  metrics: LogMetric[];
  narrative: string;
  status: LogStatus;
  autoKeys: string[];
  notes: string | null;
  correctionNote: string | null;
  hasBlockers: boolean;
  /** Lower-cased haystack for the client-side search box. */
  searchText: string;
};

/** The one metric each variant is graded on — its headline output. */
export const PRIMARY_METRIC: Record<LogVariant, string> = {
  DISCOVERY_SPECIALIST: "discoveryCallsCompleted",
  APPOINTMENT_SETTER: "appointmentsSet",
  DELIVERY_COACH: "sessionsDelivered",
};

export type DailyTargets = Record<LogVariant, number>;

const singular = (unit: string, n: number): string =>
  n === 1 && unit.endsWith("s") ? unit.replace(/s$/, "") : unit;

/** Median of a numeric list (0 for an empty list). */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Build the metric-chip list for an entry, headline metric first, only fields with a value. */
export function metricsFor(
  variant: LogVariant,
  values: Record<string, number>,
  autoKeys: string[],
): LogMetric[] {
  const primaryKey = PRIMARY_METRIC[variant];
  const fields = DAILY_LOG_FIELDS[variant] ?? [];
  const list: LogMetric[] = [];
  for (const [key] of fields) {
    const value = values[key];
    if (value === null || value === undefined) continue;
    list.push({
      key,
      value,
      // "1 no-show", not "1 no-shows" — the chip reads as a sentence fragment
      unit: singular(LOG_FIELD_UNIT[key] ?? key, value),
      short: LOG_FIELD_SHORT[key] ?? key,
      auto: autoKeys.includes(key),
      primary: key === primaryKey,
    });
  }
  // headline metric leads the row
  list.sort((a, b) => Number(b.primary) - Number(a.primary));
  return list;
}

/**
 * The phrase each field contributes to the narrative, as an explicit [one, many] pair.
 *
 * Not derived by chopping an "s" off the end: the plural noun sits in a different place in
 * each phrase ("proposals sent", "new leads contacted"), so a generic rule silently produces
 * "1 proposals sent". Spelling both out is the only thing that reads right in every case.
 */
const NARRATIVE_PHRASE: Record<string, [one: string, many: string]> = {
  discoveryCallsCompleted: ["discovery call", "discovery calls"],
  highlyQualifiedCalls: ["highly qualified", "highly qualified"],
  proposalsSent: ["proposal sent", "proposals sent"],
  appointmentsSet: ["appointment set", "appointments set"],
  newLeadsContacted: ["new lead contacted", "new leads contacted"],
  leadsAddedToPipeline: ["added to pipeline", "added to pipeline"],
  sessionsDelivered: ["session delivered", "sessions delivered"],
  assignmentsReviewed: ["assignment reviewed", "assignments reviewed"],
  studentsFlaggedAtRisk: ["flagged at risk", "flagged at risk"],
};

/** The (up to three) fields each variant's narrative is built from, most salient first. */
const NARRATIVE_FIELDS: Record<LogVariant, string[]> = {
  DISCOVERY_SPECIALIST: ["discoveryCallsCompleted", "highlyQualifiedCalls", "proposalsSent"],
  APPOINTMENT_SETTER: ["appointmentsSet", "newLeadsContacted", "leadsAddedToPipeline"],
  DELIVERY_COACH: ["sessionsDelivered", "assignmentsReviewed", "studentsFlaggedAtRisk"],
};

/** A plain-language sentence describing the day, built from the salient fields. */
export function describeLog(variant: LogVariant, values: Record<string, number>): string {
  const kept: string[] = [];
  for (const key of NARRATIVE_FIELDS[variant] ?? []) {
    const n = values[key];
    if (n === null || n === undefined) continue;
    const phrase = NARRATIVE_PHRASE[key];
    if (!phrase) continue;
    kept.push(`${n} ${n === 1 ? phrase[0] : phrase[1]}`);
  }

  if (kept.length === 0) return "Logged the day — no numbers recorded.";
  if (kept.length === 1) return capitalize(kept[0]) + ".";
  return capitalize(kept.slice(0, -1).join(", ")) + ", and " + kept[kept.length - 1] + ".";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Grade a day against its reference (target, else recent median). Returns a status key
 * (for filtering + colour) and a one-line explanation of the comparison.
 */
export function deriveStatus(args: {
  variant: LogVariant;
  values: Record<string, number>;
  /** Person's recent median of the headline metric (0 if no history). */
  baseline: number;
  /** Founder-set daily target for the headline metric (0 = none set). */
  target: number;
}): LogStatus {
  const { variant, values, baseline, target } = args;
  const key = PRIMARY_METRIC[variant];
  const value = values[key] ?? 0;
  const unit = LOG_FIELD_UNIT[key] ?? "";
  const ref = target > 0 ? target : baseline;
  const refLabel = target > 0 ? "daily target" : "recent average";

  if (ref <= 0) {
    // No target and no history to compare against yet.
    if (value <= 0) {
      return { key: "quiet", label: "Quiet day", tone: "warn", context: `No ${unit} logged today.` };
    }
    return {
      key: "logged",
      label: "Logged",
      tone: "primary",
      context: "First entries in — a baseline is building.",
    };
  }

  if (value <= 0) {
    return {
      key: "quiet",
      label: "Quiet day",
      tone: "warn",
      context: `No ${unit} against a ${refLabel} of ${round(ref)} — a blocker day?`,
    };
  }

  const ratio = value / ref;
  const refText = `${refLabel} of ${round(ref)} ${singular(unit, round(ref))}`;

  if (ratio >= 1.3) {
    return {
      key: "standout",
      label: "Standout day",
      tone: "good",
      context: `${pct(ratio - 1)} above your ${refText}.`,
    };
  }
  if (ratio >= 0.85) {
    return {
      key: "ontarget",
      label: "On target",
      tone: "good",
      context: target > 0 ? `Met your ${refText}.` : `On pace with your ${refText}.`,
    };
  }
  if (ratio >= 0.5) {
    return {
      key: "belowpar",
      label: "Below par",
      tone: "warn",
      context: `${pct(1 - ratio)} below your ${refText}.`,
    };
  }
  return {
    key: "belowpar",
    label: "Below par",
    tone: "bad",
    context: `Well below your ${refText} — worth a look.`,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;
const pct = (frac: number): string => `${Math.round(frac * 100)}%`;

const BLOCKER_RX = /(block|stuck|down|outage|issue|problem|delay|couldn'?t|can'?t|no.?show|broke|fail|wait)/i;

/** A note that reads like a real blocker gets the amber flag; a plain note doesn't. */
export function looksLikeBlocker(notes: string | null): boolean {
  return !!notes && BLOCKER_RX.test(notes);
}

/** Two-letter initials for an avatar. */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function variantRole(variant: LogVariant): string {
  return LOG_VARIANT_LABEL[variant] ?? variant;
}

// ───────────────────────── entry assembly ─────────────────────────
// Everything below is still pure (Intl only), so the whole derivation has ONE home and can
// be exercised directly in a test. The server just maps Prisma rows into `RawLog` and calls
// `buildLogEntries`; it owns no grading rules of its own.

const DAY_MS = 86_400_000;
/** Days of history the "recent average" is drawn from. */
export const BASELINE_WINDOW = 14;

const fmtDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
});
const fmtTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});
const fmtMonth = new Intl.DateTimeFormat("en-GB", {
  month: "long", year: "numeric", timeZone: "Asia/Kolkata",
});

/** A stored log row, normalised — the only shape the derivation knows about. */
export type RawLog = {
  id: string;
  userId: string;
  userName: string | null;
  /** UTC-midnight Date (@db.Date encoding of an IST day). */
  date: Date;
  createdAt: Date | null;
  variant: string;
  values: Record<string, number>;
  notes: string | null;
  correctionNote: string | null;
  autoCapturedKeys: unknown;
};

/** Which relative-date rail an entry sits under. */
export function bucketFor(relDays: number, date: Date): { key: string; label: string } {
  if (relDays <= 0) return { key: "today", label: "Today" };
  if (relDays === 1) return { key: "yesterday", label: "Yesterday" };
  if (relDays <= 6) return { key: "this-week", label: "Earlier this week" };
  if (relDays <= 13) return { key: "last-week", label: "Last week" };
  return { key: `m-${date.toISOString().slice(0, 7)}`, label: fmtMonth.format(date) };
}

/**
 * Derive the timeline's entries from raw log rows.
 *
 * `rawLogs` MUST be sorted date-desc: each day is graded against the run-up *before* it, which
 * is read straight off the following items in that person's slice of the list.
 */
export function buildLogEntries(
  rawLogs: RawLog[],
  targets: DailyTargets,
  today: Date,
  withPerson: boolean,
): LogEntry[] {
  // Per-person headline-metric series, in the incoming desc order, for rolling baselines.
  const seriesByUser = new Map<string, number[]>();
  for (const l of rawLogs) {
    const primaryKey = PRIMARY_METRIC[l.variant as LogVariant];
    if (!seriesByUser.has(l.userId)) seriesByUser.set(l.userId, []);
    seriesByUser.get(l.userId)!.push(l.values[primaryKey] ?? 0);
  }
  const cursor = new Map<string, number>();
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return rawLogs.map((l) => {
    const variant = l.variant as LogVariant;
    // baseline = median of this person's OLDER entries (later in the desc series)
    const idx = cursor.get(l.userId) ?? 0;
    cursor.set(l.userId, idx + 1);
    const series = seriesByUser.get(l.userId)!;
    const baseline = median(series.slice(idx + 1, idx + 1 + BASELINE_WINDOW).filter((n) => n > 0));

    const autoKeys = Array.isArray(l.autoCapturedKeys)
      ? (l.autoCapturedKeys as unknown[]).filter((k): k is string => typeof k === "string")
      : [];
    const metrics = metricsFor(variant, l.values, autoKeys);
    const status = deriveStatus({ variant, values: l.values, baseline, target: targets[variant] ?? 0 });
    const primary = metrics.find((m) => m.primary);
    if (primary) {
      if (status.key === "standout") primary.emphasis = "up";
      else if (status.key === "belowpar" || status.key === "quiet") primary.emphasis = "down";
    }

    const dateMid = Date.UTC(l.date.getUTCFullYear(), l.date.getUTCMonth(), l.date.getUTCDate());
    const relDays = Math.round((todayMid - dateMid) / DAY_MS);
    const bucket = bucketFor(relDays, l.date);
    const dateLabel = fmtDay.format(l.date);
    const narrative = describeLog(variant, l.values);
    const person: PersonRef | null = withPerson
      ? { name: l.userName ?? "Unknown", initials: initialsOf(l.userName ?? "?"), role: variantRole(variant) }
      : null;

    return {
      id: l.id,
      date: l.date.toISOString(),
      relDays,
      dateLabel,
      submittedTimeLabel: l.createdAt ? fmtTime.format(l.createdAt) : null,
      bucketKey: bucket.key,
      bucketLabel: bucket.label,
      variant,
      person,
      metrics,
      narrative,
      status,
      autoKeys,
      notes: l.notes,
      correctionNote: l.correctionNote,
      hasBlockers: looksLikeBlocker(l.notes),
      searchText: [
        dateLabel, narrative, l.notes ?? "", l.correctionNote ?? "", status.label,
        person?.name ?? "", metrics.map((m) => `${m.value} ${m.unit}`).join(" "),
      ].join(" ").toLowerCase(),
    } satisfies LogEntry;
  });
}
