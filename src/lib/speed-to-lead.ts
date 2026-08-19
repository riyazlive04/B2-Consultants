import { slaFor, windowFor, type SlaWindow } from "./outreach-sla";

/**
 * Speed to lead - the alerting rule, as pure functions.
 *
 * `outreach-sla.ts` already grades ONE lead against the JD's four response clauses. What it
 * cannot say is "is the situation right now bad enough to interrupt a human", which is a
 * different question with a different answer: a single missed 5-minute clock is a Tuesday; forty
 * of them before lunch is an incident.
 *
 * This file answers that second question and nothing else. Pure and dependency-free - the
 * threshold is the number that will actually get argued about, so it must be adjustable and
 * checkable without a database, a session or a running server.
 *
 * THE BACKLOG PROBLEM, which shapes the whole design: production holds ~23,435 leads and
 * essentially none have ever been contacted. A naive "alert when any lead is past its deadline"
 * fires on all 23,000 of them, every tick, forever - and gets muted on day two, at which point
 * the alerting is worse than none because it also carries the false assurance of having been set
 * up. So the standing backlog and newly-arrived leads are counted SEPARATELY, and only the
 * second is a default alerting trigger.
 */

/** The minimum a caller must know about a lead to grade it. */
export type SpeedToLeadLead = {
  id: string;
  name: string;
  /** When they opted in. The clock starts here - not at row creation. */
  optInAt: Date;
  /** First SPOKE call, or null if nobody has ever connected. */
  connectedAt: Date | null;
  ownerId: string | null;
  ownerName: string | null;
};

export type SpeedToLeadBreach = {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  window: SlaWindow;
  /** Minutes since opt-in, at `now`. */
  ageMinutes: number;
};

export type SpeedToLeadReport = {
  /** Leads that arrived inside the lookback and are past the threshold, still unconnected. */
  breaches: SpeedToLeadBreach[];
  /** Newly-arrived leads considered, whatever their state. The denominator for `hitRate`. */
  considered: number;
  /** Fraction of considered leads connected within the five-minute clock, 0–1. Null if none. */
  hitRate: number | null;
  /** Age in minutes of the oldest unconnected lead in `breaches`. 0 when there are none. */
  worstAgeMinutes: number;
  /** Breach counts by owner, worst first. Unassigned leads collect under a null id. */
  byOwner: { ownerId: string | null; ownerName: string; count: number }[];
};

export type SpeedToLeadOptions = {
  /** Minutes after opt-in at which an unconnected lead counts as a breach. */
  thresholdMinutes: number;
  /**
   * How far back to look for "newly arrived". Anything older is standing backlog and is
   * deliberately not the subject of this alert - see the module note.
   */
  lookbackMinutes: number;
};

const MINUTE_MS = 60_000;

/**
 * Grades a batch of leads and produces the alert's payload.
 *
 * `leads` should already be restricted to the lookback window by the caller's query - passing
 * 23,000 rows here would work, but pulling them out of the database every five minutes would
 * not. The function re-checks the window anyway, so correctness does not depend on the query
 * being right.
 */
export function speedToLeadReport(
  leads: SpeedToLeadLead[],
  now: Date,
  opts: SpeedToLeadOptions,
): SpeedToLeadReport {
  const lookbackFrom = now.getTime() - opts.lookbackMinutes * MINUTE_MS;
  const recent = leads.filter((l) => l.optInAt.getTime() >= lookbackFrom);

  const breaches: SpeedToLeadBreach[] = [];
  let metFiveMinute = 0;

  for (const lead of recent) {
    const ageMinutes = Math.floor((now.getTime() - lead.optInAt.getTime()) / MINUTE_MS);

    if (lead.connectedAt) {
      // Reuse the JD's own verdict rather than re-deriving "within five minutes" here - the
      // definition of a met SLA belongs in one place.
      if (slaFor(lead.optInAt, lead.connectedAt, now).metFiveMinute) metFiveMinute++;
      continue;
    }

    // Not connected. A lead is only a breach once it is PAST the threshold; one that is
    // 90 seconds old is someone's next call, not a failure.
    if (ageMinutes < opts.thresholdMinutes) continue;

    breaches.push({
      id: lead.id,
      name: lead.name,
      ownerId: lead.ownerId,
      ownerName: lead.ownerName,
      window: windowFor(lead.optInAt),
      ageMinutes,
    });
  }

  breaches.sort((a, b) => b.ageMinutes - a.ageMinutes);

  const byOwnerMap = new Map<string | null, { ownerName: string; count: number }>();
  for (const b of breaches) {
    const entry = byOwnerMap.get(b.ownerId);
    if (entry) entry.count++;
    // "Unassigned" is a first-class row, not an omission: on this database it is expected to be
    // the largest bucket by far, and hiding it would make the alert say the team is doing fine.
    else byOwnerMap.set(b.ownerId, { ownerName: b.ownerName ?? "Unassigned", count: 1 });
  }

  const byOwner = [...byOwnerMap.entries()]
    .map(([ownerId, v]) => ({ ownerId, ownerName: v.ownerName, count: v.count }))
    .sort((a, b) => b.count - a.count);

  return {
    breaches,
    considered: recent.length,
    hitRate: recent.length ? metFiveMinute / recent.length : null,
    worstAgeMinutes: breaches.length ? breaches[0]!.ageMinutes : 0,
    byOwner,
  };
}

/**
 * Should this report interrupt someone?
 *
 * Separated from `speedToLeadReport` on purpose: the report is a fact and is always worth
 * computing (the digest and the desk both read it), while "is this worth an email" is a policy
 * that ships off and is tuned by the founders.
 */
export function shouldAlert(report: SpeedToLeadReport, minBreaches: number): boolean {
  return report.breaches.length >= Math.max(1, minBreaches);
}

/**
 * The alert's one-line subject. Kept here rather than in the sender so it is covered by the
 * pure tests - a subject line that says the wrong number is the whole message being wrong.
 */
export function alertSubject(report: SpeedToLeadReport): string {
  const n = report.breaches.length;
  return `${n} lead${n === 1 ? "" : "s"} waiting - oldest ${formatAge(report.worstAgeMinutes)}`;
}

// ───────────────────────── First-call verdict (board card + report) ─────────────────────────

/**
 * How the FIRST CALL to a lead stands against the five-minute target.
 *
 *   HIT      - called within five minutes of opting in
 *   LATE     - called, but after the five minutes had passed
 *   DUE      - not yet called, and the five minutes are still running
 *   OVERDUE  - not yet called, and the five minutes are gone
 *
 * This is the ATTEMPT, not the connection: the setter's job is to pick up the phone within five
 * minutes, and a no-answer at minute three is that job done. `slaFor` / `contactedAt` measure the
 * first CONVERSATION (SPOKE only) and stay as they are - the two answer different questions, and
 * the board card and the speed report ask this one.
 */
export type FirstCallState = "HIT" | "LATE" | "DUE" | "OVERDUE";

export type FirstCallVerdict = {
  state: FirstCallState;
  /** HIT/LATE: minutes from opt-in to the call. DUE/OVERDUE: minutes since opt-in. Whole minutes, floor. */
  minutes: number;
  /** DUE only: whole seconds left on the clock. */
  secondsLeft: number | null;
};

export const FIRST_CALL_TARGET_MS = 5 * MINUTE_MS;

export function firstCallVerdict(optInAt: Date, firstCallAt: Date | null, now: Date): FirstCallVerdict {
  if (firstCallAt) {
    const delta = Math.max(0, firstCallAt.getTime() - optInAt.getTime());
    return { state: delta <= FIRST_CALL_TARGET_MS ? "HIT" : "LATE", minutes: Math.floor(delta / MINUTE_MS), secondsLeft: null };
  }
  const age = Math.max(0, now.getTime() - optInAt.getTime());
  if (age <= FIRST_CALL_TARGET_MS) {
    return { state: "DUE", minutes: Math.floor(age / MINUTE_MS), secondsLeft: Math.ceil((FIRST_CALL_TARGET_MS - age) / 1000) };
  }
  return { state: "OVERDUE", minutes: Math.floor(age / MINUTE_MS), secondsLeft: null };
}

/** One-line label for a verdict chip: "Called in 3 min", "Not called - 18 min", "Call due - 1:40 left". */
export function firstCallLabel(v: FirstCallVerdict): string {
  switch (v.state) {
    case "HIT": return `Called in ${formatAge(v.minutes)}`;
    case "LATE": return `Called after ${formatAge(v.minutes)}`;
    case "OVERDUE": return `Not called - ${formatAge(v.minutes)}`;
    case "DUE": {
      const s = v.secondsLeft ?? 0;
      return `Call due - ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
    }
  }
}

/** "3 min" / "2 h 15 min" / "1 d 4 h". Compact enough for a subject line. */
export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} d ${remHours} h` : `${days} d`;
}

/** Percentage string for the five-minute hit rate, or an em dash when there is no denominator. */
export function formatHitRate(hitRate: number | null): string {
  if (hitRate === null) return "-";
  return `${Math.round(hitRate * 100)}%`;
}
