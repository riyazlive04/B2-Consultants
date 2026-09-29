"use client";

import { Clock, Globe } from "lucide-react";
import { dateIn, timeIn, useDualClock, ZONES, type Zone } from "@/lib/use-dual-clock";

/**
 * Time-zone preference (profile). Two zones the business actually spans - India (IST) and
 * Germany (CET/CEST) - with a live clock for each. It AUTO-SELECTS from the browser's own
 * time zone (Intl): open it in India and it lands on Indian time, open it in Germany and it
 * lands on German time. The choice is remembered in localStorage so a manual override sticks.
 *
 * This is where the preference is CHANGED. The top bar's `NavClock` reads the same hook and
 * updates the moment a choice is made here - they share `lib/use-dual-clock`, so the zones, the
 * detection rule and the storage key cannot drift between the two surfaces.
 *
 * Seconds tick here (1s) and not in the nav (60s): this card is the one people watch.
 */
export function TimeZoneCard() {
  const { zone, detected, now, pick } = useDualClock(1000);

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-h2 font-semibold">
        <Globe size={17} /> Time zone
      </h2>
      <p className="mt-1 text-sm text-muted">
        Auto-selected from your location{" "}
        <span className="font-medium text-ink-2">({ZONES[detected].flag} {ZONES[detected].label})</span> -
        switch it any time. Your choice is remembered on this device and shows in the top bar.
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
                    {now ? timeIn(meta.tz, now, true) : "-"}
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
