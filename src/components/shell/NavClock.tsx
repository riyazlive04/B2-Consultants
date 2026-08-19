"use client";

import Link from "next/link";
import { useDualClock, timeIn, ZONES, type Zone } from "@/lib/use-dual-clock";

/**
 * Both business clocks in the top bar - 🇮🇳 14:32:07 · 🇩🇪 11:02:07.
 *
 * The dual clock already existed, buried on /profile, which is nowhere near where it is needed:
 * the question "is it a reasonable hour to ring Germany right now" is asked mid-call, from
 * whatever screen the person is on, and nobody navigates to a settings page to answer it.
 *
 * READ-ONLY on purpose. The profile card remains the place to CHANGE the preferred zone; this
 * just shows both and marks which one is yours. Putting a control here would add a click target
 * to the most contested 40px of the app for a setting changed once.
 *
 * ── Responsive contract ──────────────────────────────────────────────────────────
 * The top bar sheds WHOLE controls at breakpoints rather than shrinking them (a 40px button
 * rendered at 18px is an unhittable target). So:
 *   ≥ lg   both zones - the full answer
 *   ≥ sm   the OTHER zone only - your own local time is on your device's own clock; the one you
 *          cannot get anywhere else is the far end
 *   < sm   hidden - a phone has neither the room nor the need
 */
export function NavClock() {
  /**
   * Seconds, ticking once a second.
   *
   * This started as HH:MM on a one-minute interval, which was reported as "not live" - and it was
   * right. A minute clock is visually indistinguishable from a stopped one: nobody watches the top
   * bar for sixty seconds to find out whether it is working, so the only honest way to show that a
   * clock is running is to let it run. The state is local to this component, so a tick re-renders
   * two spans and nothing else in the shell.
   */
  const { zone, now } = useDualClock(1000);

  // Until mounted `now` is null - render the same placeholder the server did, or hydration
  // throws away the header. See useDualClock for the full reasoning.
  const other: Zone = zone === "IN" ? "DE" : "IN";

  const Chip = ({ z, className }: { z: Zone; className?: string }) => (
    <span className={`flex items-center gap-1 ${className ?? ""}`}>
      <span aria-hidden className="text-[13px] leading-none">{ZONES[z].flag}</span>
      {/* `tnum` is load-bearing at this resolution: proportional digits would make the whole top
          bar twitch sideways every second as the glyph widths changed. */}
      <span className="tnum">{now ? timeIn(ZONES[z].tz, now, true) : "--:--:--"}</span>
      <span className="sr-only">{ZONES[z].label}</span>
    </span>
  );

  return (
    <Link
      href="/profile"
      title={
        now
          ? `${ZONES.IN.label} ${timeIn(ZONES.IN.tz, now)} · ${ZONES.DE.label} ${timeIn(ZONES.DE.tz, now)} - change your zone in your profile`
          : "Indian and German time"
      }
      className="hidden h-10 flex-none items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink sm:flex"
    >
      {/* Your own zone: dropped first when space runs out. */}
      <Chip z={zone} className="hidden lg:flex" />
      <span aria-hidden className="hidden text-ink-3 lg:inline">·</span>
      {/* The far end: the figure you cannot read off your own device. */}
      <Chip z={other} />
    </Link>
  );
}
