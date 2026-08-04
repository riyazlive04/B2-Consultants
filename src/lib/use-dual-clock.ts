"use client";

import { useEffect, useState } from "react";

/**
 * The two clocks this business runs on — India (IST) and Germany (CET/CEST).
 *
 * Extracted from `profile/_components/TimeZoneCard` so the top bar and the profile card share one
 * definition of the zones, the detection rule and the stored preference. They were the same logic
 * written once and about to be written twice.
 *
 * The preference lives in `localStorage`, not the database: it is a display choice, it needs no
 * round trip and no schema, and it is legitimately per-device — the same person on the office
 * desktop and a phone abroad wants different answers. The app's BUSINESS logic stays IST-anchored
 * regardless (the daily-log cutoff, the SOP ladder); this is only what a human reads.
 */

export type Zone = "IN" | "DE";

export const ZONES: Record<Zone, { label: string; tz: string; flag: string; note: string }> = {
  IN: { label: "Indian time", tz: "Asia/Kolkata", flag: "🇮🇳", note: "IST · UTC+5:30" },
  DE: { label: "German time", tz: "Europe/Berlin", flag: "🇩🇪", note: "CET/CEST · UTC+1/+2" },
};

export const TZ_STORAGE_KEY = "b2_tz_pref";

/** Guess the person's zone from the browser's own time zone. */
export function detectZone(): Zone {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/kolkata|calcutta/i.test(tz)) return "IN";
    if (/berlin/i.test(tz) || tz.startsWith("Europe/")) return "DE";
  } catch {
    /* ignore — fall through to the IST default */
  }
  return "IN"; // the app's home zone
}

export function timeIn(tz: string, now: Date, withSeconds = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(now);
}

export function dateIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(now);
}

/**
 * A ticking clock plus the resolved zone preference.
 *
 * `now` starts as `null` and is only set inside an effect. That is deliberate and load-bearing:
 * this is a client component, so Next.js still renders it on the SERVER, and seeding state with
 * `new Date()` would make the server emit one time and the browser hydrate with another a second
 * later. React treats that as corrupt markup and throws away the whole boundary. Rendering a
 * placeholder until mounted makes both passes identical.
 *
 * `tickMs` defaults to a minute. The profile card asks for 1000 because it shows seconds; the nav
 * clock does not, and re-rendering the entire app shell once a second to change nothing is a cost
 * with no benefit.
 */
export function useDualClock(tickMs = 60_000) {
  const [zone, setZone] = useState<Zone>("IN");
  const [detected, setDetected] = useState<Zone>("IN");
  const [now, setNow] = useState<Date | null>(null);

  // Resolve the preference on mount: a stored override wins; otherwise auto-detect.
  useEffect(() => {
    const d = detectZone();
    setDetected(d);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(TZ_STORAGE_KEY);
    } catch {
      /* ignore — private mode, or storage disabled */
    }
    setZone(stored === "IN" || stored === "DE" ? (stored as Zone) : d);
    setNow(new Date());
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  /**
   * Cross-tab and cross-component sync. The profile card writes the preference; the nav clock in
   * the SAME document has already rendered and would otherwise keep the old highlight until a
   * reload. `storage` covers other tabs, the custom event covers this one (browsers do not fire
   * `storage` at the tab that wrote it).
   */
  useEffect(() => {
    const apply = (v: string | null) => {
      if (v === "IN" || v === "DE") setZone(v);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === TZ_STORAGE_KEY) apply(e.newValue);
    };
    const onLocal = (e: Event) => apply((e as CustomEvent<string>).detail ?? null);
    window.addEventListener("storage", onStorage);
    window.addEventListener("b2-tz-pref", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("b2-tz-pref", onLocal);
    };
  }, []);

  const pick = (z: Zone) => {
    setZone(z);
    try {
      localStorage.setItem(TZ_STORAGE_KEY, z);
    } catch {
      /* ignore */
    }
    // Tell every other clock in this document, since `storage` will not.
    window.dispatchEvent(new CustomEvent("b2-tz-pref", { detail: z }));
  };

  return { zone, detected, now, pick };
}
