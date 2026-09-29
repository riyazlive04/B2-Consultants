"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Timer, TrendingUp } from "lucide-react";
import { IconButton } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";

/**
 * Personal work-time widget pair: an automatic Time Tracker feeding a weekly
 * Progress bar chart. No start button - accrual is handled app-wide by the
 * headless <WorkTimeTracker /> in the (app) layout.
 *
 * THIS COMPONENT NO LONGER OWNS THE CLOCK. It used to run the setInterval AND
 * keep the whole history in one un-scoped localStorage key, which produced two
 * bugs: time only accrued while the dashboard was on screen, and the day-wise
 * history vanished on a new device, a cleared browser or a second user sharing
 * a machine. Totals now come from the server (WorkDay, one row per IST day);
 * this renders them and ticks the seconds between heartbeats so the clock reads
 * smoothly.
 */

const DAILY_GOAL_SEC = 8 * 3600; // ring fills toward an 8-hour day

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtShort(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export type WorkTrackerProps = {
  /** Day key (YYYY-MM-DD, IST) -> seconds, from the server. */
  byDay: Record<string, number>;
  /** Mon->Sun day keys of the current IST week. */
  weekKeys: string[];
  /** Today's IST day key. */
  today: string;
};

export function WorkTracker({ byDay, weekKeys, today }: WorkTrackerProps) {
  const [days, setDays] = useState<Record<string, number>>(byDay);
  /** Server total for today plus the moment it was read, so the display can
   *  advance between the 30s heartbeats without inventing time. */
  const [base, setBase] = useState({ sec: byDay[today] ?? 0, at: Date.now() });
  const [display, setDisplay] = useState(byDay[today] ?? 0);

  // The layout's tracker owns the network; this just listens for its totals.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        todaySec?: number;
        byDay?: Record<string, number>;
      };
      if (detail?.byDay) setDays(detail.byDay);
      if (typeof detail?.todaySec === "number") {
        setBase({ sec: detail.todaySec, at: Date.now() });
        setDays((prev) => ({ ...prev, [today]: detail.todaySec as number }));
      }
    };
    window.addEventListener("b2-work-time", onUpdate);
    return () => window.removeEventListener("b2-work-time", onUpdate);
  }, [today]);

  // Smooth 1s clock, corrected every time a heartbeat lands.
  useEffect(() => {
    const id = setInterval(() => {
      setDisplay(base.sec + Math.floor((Date.now() - base.at) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [base]);

  const todaySec = Math.max(display, base.sec);

  /** Clears today's stored total. Confirmed first - it deletes real recorded time. */
  const reset = async () => {
    const ok = await askConfirm({
      title: "Reset today's time?",
      body: "Today's tracked work time will be set back to zero. Previous days are not affected.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    try {
      const res = await fetch("/api/work-time", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setBase({ sec: 0, at: Date.now() });
      setDisplay(0);
      setDays((prev) => ({ ...prev, [today]: 0 }));
      toast("Today's time reset");
    } catch {
      toast("Could not reset the timer", "error");
    }
  };

  // circular ring geometry
  const R = 66;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, todaySec / DAILY_GOAL_SEC);

  // weekly bars - today reads live, past days come straight from the server
  const weekSecs = weekKeys.map((k) => (k === today ? todaySec : days[k] ?? 0));
  const weekTotal = weekSecs.reduce((a, b) => a + b, 0);
  const maxSec = Math.max(1, ...weekSecs);
  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Progress: weekly bar chart (spans 2 columns on desktop) - sky hero */}
      <div className="hero-sky rise-in relative overflow-hidden rounded-hero p-6 lg:col-span-2">
        <div className="relative flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <TrendingUp size={14} /> Work time · this week
            </p>
            <p className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {(weekTotal / 3600).toFixed(1)}
              <span className="ml-1 text-lg font-semibold text-ink-2">h</span>
            </p>
          </div>
          <span className="rounded-full bg-surface/70 px-2.5 py-1 text-xs font-semibold text-ink">
            Today {fmtShort(todaySec)}
          </span>
        </div>

        <div className="relative mt-6 flex items-end justify-between gap-2" style={{ height: 112 }}>
          {weekSecs.map((sec, i) => {
            const isToday = weekKeys[i] === today;
            const h = Math.max(6, Math.round((sec / maxSec) * 96));
            return (
              <div key={weekKeys[i]} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-[26px] rounded-full transition-all"
                    style={{ height: h, background: isToday ? "var(--primary)" : "var(--primary-tint)" }}
                    title={`${dayLetters[i]} · ${fmtShort(sec)}`}
                  />
                </div>
                <span className={`text-caption ${isToday ? "font-bold text-ink" : "text-ink-2"}`}>
                  {dayLetters[i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time tracker: automatic, runs on every screen */}
      <div className="glass-card rise-in card-hover flex flex-col rounded-card p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Timer size={14} /> Time tracker
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold"
            style={{ background: "var(--good-bg)", color: "var(--good)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--good)" }} />
            Tracking
          </span>
        </div>

        <div className="relative mx-auto my-4 grid place-items-center">
          <svg width={168} height={168} viewBox="0 0 168 168" className="-rotate-90">
            <circle cx="84" cy="84" r={R} fill="none" stroke="var(--bg-surface-2)" strokeWidth="12" />
            <circle
              cx="84"
              cy="84"
              r={R}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              style={{ transition: "stroke-dashoffset 500ms ease" }}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="font-display text-3xl font-bold tabular-nums tracking-tight">
              {fmtClock(todaySec)}
            </span>
            <span className="text-xs text-muted">Work time today</span>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-center gap-2 text-xs text-muted">
          <span>Counts on every screen while the app is open</span>
          <IconButton label="Reset today's time" onClick={reset}>
            <RotateCcw size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
