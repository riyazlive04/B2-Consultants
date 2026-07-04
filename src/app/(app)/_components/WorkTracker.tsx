"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Timer, TrendingUp } from "lucide-react";

/**
 * Personal work-time widget pair (Crextio-style): an automatic Time Tracker that
 * counts only while you're actually using the app (tab visible + recent activity),
 * feeding a weekly Progress bar chart. No start button — it tracks itself and
 * pauses when you're idle or away. State lives in localStorage (per device).
 */

const STORAGE_KEY = "b2-worktracker-v1";
const DAILY_GOAL_SEC = 8 * 3600; // ring fills toward an 8-hour day
const IDLE_MS = 60_000; // no input for 1 min -> treat as idle, stop counting

/** Local YYYY-MM-DD (not UTC) so "today" matches the user's clock. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mon->Sun keys for the week containing `ref`. */
function weekKeys(ref: Date): string[] {
  const monday = new Date(ref);
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(monday.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dayKey(d);
  });
}

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

export function WorkTracker() {
  const [days, setDays] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);

  const lastActivity = useRef(0);
  const daysRef = useRef(days);
  const lastSave = useRef(0);
  daysRef.current = days;

  // hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { days?: Record<string, number> };
        if (parsed.days) setDays(parsed.days);
      }
    } catch {
      /* ignore corrupt storage */
    }
    lastActivity.current = Date.now();
    lastSave.current = Date.now();
    setReady(true);
  }, []);

  // register "user is here" signals: any input, or the tab becoming visible
  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const onVis = () => {
      if (document.visibilityState === "visible") lastActivity.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // one tick per second: add a second only when genuinely active
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const isActive =
        document.visibilityState === "visible" && Date.now() - lastActivity.current < IDLE_MS;
      setActive(isActive);
      if (isActive) {
        const key = dayKey(new Date());
        setDays((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [ready]);

  // persist: throttled to every 5s, plus a final flush when leaving
  useEffect(() => {
    if (!ready) return;
    const now = Date.now();
    if (now - lastSave.current >= 5000) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ days }));
      lastSave.current = now;
    }
  }, [days, ready]);

  useEffect(() => {
    const flush = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ days: daysRef.current }));
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

  const today = dayKey(new Date());
  const todaySec = days[today] ?? 0;

  const reset = () => {
    setDays((prev) => ({ ...prev, [today]: 0 }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ days: { ...daysRef.current, [today]: 0 } }));
  };

  // circular ring geometry
  const R = 66;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, todaySec / DAILY_GOAL_SEC);

  // weekly bars
  const week = weekKeys(new Date());
  const weekSecs = week.map((k) => days[k] ?? 0);
  const weekTotal = weekSecs.reduce((a, b) => a + b, 0);
  const maxSec = Math.max(1, ...weekSecs);
  const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Progress: weekly bar chart (spans 2 columns on desktop) */}
      <div className="rise-in card-hover rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <TrendingUp size={14} /> Work time · this week
            </p>
            <p className="mt-1 font-display text-3xl font-bold tracking-tight">
              {(weekTotal / 3600).toFixed(1)}
              <span className="ml-1 text-lg font-semibold text-muted">h</span>
            </p>
          </div>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            Today {fmtShort(todaySec)}
          </span>
        </div>

        <div className="mt-5 flex items-end justify-between gap-2" style={{ height: 96 }}>
          {weekSecs.map((sec, i) => {
            const isToday = week[i] === today;
            const h = Math.max(6, Math.round((sec / maxSec) * 84));
            return (
              <div key={week[i]} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-[26px] rounded-full transition-all"
                    style={{ height: h, background: isToday ? "var(--accent)" : "var(--accent-soft)" }}
                    title={`${dayLetters[i]} · ${fmtShort(sec)}`}
                  />
                </div>
                <span className={`text-[11px] ${isToday ? "font-bold text-accent" : "text-muted"}`}>
                  {dayLetters[i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time tracker: automatic, activity-based */}
      <div className="rise-in card-hover flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Timer size={14} /> Time tracker
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: active ? "var(--ok-soft)" : "var(--surface-2)",
              color: active ? "var(--ok)" : "var(--muted)",
            }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${active ? "flame" : ""}`}
              style={{ background: active ? "var(--ok)" : "var(--muted)" }}
            />
            {active ? "Tracking" : "Idle"}
          </span>
        </div>

        <div className="relative mx-auto my-4 grid place-items-center">
          <svg width={168} height={168} viewBox="0 0 168 168" className="-rotate-90">
            <circle cx="84" cy="84" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
            <circle
              cx="84"
              cy="84"
              r={R}
              fill="none"
              stroke="var(--accent)"
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
          <span>Auto-tracks while you work</span>
          <button
            type="button"
            onClick={reset}
            aria-label="Reset today's time"
            title="Reset today"
            className="grid h-8 w-8 place-items-center rounded-full border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
