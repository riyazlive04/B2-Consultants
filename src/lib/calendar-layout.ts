/**
 * Side-by-side packing for clashing events in one day column (pure).
 *
 * Same rule as FullCalendar's timegrid, which Synamate uses: events that overlap form a cluster,
 * each event takes the first column that is free at its start, and every event in a cluster shares
 * the cluster's column count. Touching (one ends exactly when the next starts) is not an overlap.
 */

export type DayItem = { id: string; startMin: number; endMin: number };
export type Placed = { id: string; top: number; height: number; col: number; cols: number };

/** Minutes are minutes-of-day; events are clipped to [dayStartMin, dayEndMin), outside ones dropped. */
export function layoutDay(items: DayItem[], dayStartMin = 0, dayEndMin = 1440): Placed[] {
  const span = dayEndMin - dayStartMin;
  const clipped = items
    .map((e) => ({ id: e.id, s: Math.max(e.startMin, dayStartMin), e: Math.min(e.endMin, dayEndMin) }))
    .filter((e) => e.e > e.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = []; // per column, when its last event ends
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const p of cluster) out.push({ ...p, cols: colEnds.length });
    cluster = [];
    colEnds = [];
  };

  for (const ev of clipped) {
    if (ev.s >= clusterEnd) flush();
    clusterEnd = Math.max(cluster.length ? clusterEnd : -Infinity, ev.e);
    let col = colEnds.findIndex((end) => end <= ev.s);
    if (col < 0) col = colEnds.push(ev.e) - 1;
    else colEnds[col] = ev.e;
    cluster.push({ id: ev.id, top: ((ev.s - dayStartMin) / span) * 100, height: ((ev.e - ev.s) / span) * 100, col, cols: 0 });
  }
  flush();
  return out;
}
