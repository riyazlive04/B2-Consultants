"use client";

import { useEffect, useState } from "react";
import { Clock, Globe } from "lucide-react";

/**
 * Time-zone preference (profile). Two zones the business actually spans — India (IST) and
 * Germany (CET/CEST) — with a live clock for each. It AUTO-SELECTS from the browser's own
 * time zone (Intl): open it in India and it lands on Indian time, open it in Germany and it
 * lands on German time. The choice is remembered in localStorage so a manual override sticks.
 *
 * Client-only + localStorage on purpose: this is a display preference, no server round-trip,
 * no schema change. The app's business logic stays IST-anchored (daily-log cutoff, the SOP
 * ladder); this card is the person's own clock.
 */

type Zone = "IN" | "DE";

const ZONES: Record<Zone, { label: string; tz: string; flag: string; note: string }> = {
  IN: { label: "Indian time", tz: "Asia/Kolkata", flag: "🇮🇳", note: "IST · UTC+5:30" },
  DE: { label: "German time", tz: "Europe/Berlin", flag: "🇩🇪", note: "CET/CEST · UTC+1/+2" },
};

const STORAGE_KEY = "b2_tz_pref";

/** Guess the person's zone from the browser's own time zone. */
function detectZone(): Zone {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/kolkata|calcutta/i.test(tz)) return "IN";
    if (/berlin/i.test(tz) || tz.startsWith("Europe/")) return "DE";
  } catch {
    /* ignore — fall through to the IST default */
  }
  return "IN"; // the app's home zone
}

function timeIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function dateIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(now);
}

export function TimeZoneCard() {
  const [zone, setZone] = useState<Zone>("IN");
  const [detected, setDetected] = useState<Zone>("IN");
  const [now, setNow] = useState<Date | null>(null);

  // Resolve the preference on mount: a stored override wins; otherwise auto-detect.
  useEffect(() => {
    const d = detectZone();
    setDetected(d);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setZone(stored === "IN" || stored === "DE" ? (stored as Zone) : d);
    setNow(new Date());
  }, []);

  // Tick the clocks once a second.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const pick = (z: Zone) => {
    setZone(z);
    try {
      localStorage.setItem(STORAGE_KEY, z);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-h2 font-semibold">
        <Globe size={17} /> Time zone
      </h2>
      <p className="mt-1 text-sm text-muted">
        Auto-selected from your location{" "}
        <span className="font-medium text-ink-2">({ZONES[detected].flag} {ZONES[detected].label})</span> —
        switch it any time. Your choice is remembered on this device.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(Object.keys(ZONES) as Zone[]).map((z) => {
          const active = zone === z;
          const meta = ZONES[z];
          return (
            <button
              key={z}
              type="button"
              onClick={() => pick(z)}
              aria-pressed={active}
              className={`flex items-center gap-3 rounded-card border p-4 text-left transition-colors ${
                active
                  ? "border-primary bg-primary-soft"
                  : "border-line bg-surface-2 hover:border-primary-tint"
              }`}
            >
              <span className="text-2xl leading-none">{meta.flag}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${active ? "text-primary-strong" : "text-ink"}`}>
                    {meta.label}
                  </span>
                  {detected === z && (
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                      here
                    </span>
                  )}
                </span>
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-bold tabular-nums text-ink">
                    {now ? timeIn(meta.tz, now) : "—"}
                  </span>
                </span>
                <span className="mt-0.5 block text-caption text-muted">
                  {now ? dateIn(meta.tz, now) : ""} · {meta.note}
                </span>
              </span>
              <span
                aria-hidden
                className={`grid h-5 w-5 flex-none place-items-center rounded-full border ${
                  active ? "border-primary bg-primary text-on-accent" : "border-line-strong bg-surface"
                }`}
              >
                {active && <Clock size={12} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
