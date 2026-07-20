/**
 * Video completion (spec §10.3, restated in §17: "Tracked watch % overrides self-reported
 * 'watched'").
 *
 * The founders' complaint is specific: a student ticks "watched", but only viewed 40%. The
 * tick is a claim; the tracked percentage is the evidence. So wherever both exist, this
 * module answers with the evidence — that is the entire point of the rule.
 *
 * Pure: pass the row's fields in.
 */

/** Watched at or above this share counts as complete. */
export const COMPLETION_THRESHOLD_PCT = 90;

export type WatchRow = {
  /** Tracked high-water mark, 0–100. Null = never tracked. */
  watchedPct: number | null;
  /** Whether the student ticked "watched". */
  selfReported: boolean;
};

export type WatchTruth = {
  /** The percentage to display and store. */
  pct: number;
  complete: boolean;
  /** Where the number came from — the UI says so, so a student can't be confused by it. */
  basis: "tracked" | "self_reported" | "none";
  /** True when the tick and the tracking disagree — the case the founders want surfaced. */
  disputed: boolean;
  explain: string;
};

/**
 * Resolve what a student actually watched.
 *
 * When tracking exists it wins outright, even if it contradicts the tick — including when it
 * says 40% and the student says done. An untracked tick still counts (legacy rows, and hosts
 * that report no progress), because treating those as 0% would erase real history the moment
 * this feature shipped.
 */
export function resolveWatchTruth(row: WatchRow): WatchTruth {
  const tracked = row.watchedPct;

  if (tracked !== null) {
    const pct = clampPct(tracked);
    const complete = pct >= COMPLETION_THRESHOLD_PCT;
    const disputed = row.selfReported && !complete;
    return {
      pct,
      complete,
      basis: "tracked",
      disputed,
      explain: disputed
        ? `Marked watched, but tracked at ${pct}% — tracking is the source of truth.`
        : `Tracked at ${pct}%.`,
    };
  }

  if (row.selfReported) {
    return {
      pct: 100,
      complete: true,
      basis: "self_reported",
      disputed: false,
      explain: "Marked watched (no tracking data for this recording).",
    };
  }

  return { pct: 0, complete: false, basis: "none", disputed: false, explain: "Not started." };
}

/**
 * Fold a heartbeat into the stored progress.
 *
 * A HIGH-WATER MARK, deliberately: scrubbing back to rewatch a hard bit must not delete the
 * fact that you reached the end. Without this, the last heartbeat before closing the tab
 * would overwrite a completed video with wherever the playhead happened to sit.
 */
export function mergeWatchProgress(
  storedPct: number | null,
  positionSecs: number,
  durationSecs: number,
): number {
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) return clampPct(storedPct ?? 0);
  const live = clampPct(Math.round((positionSecs / durationSecs) * 100));
  return Math.max(storedPct ?? 0, live);
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}
