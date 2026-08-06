"use client";

import { useEffect } from "react";

/**
 * App-wide work-time accrual. Headless — renders nothing.
 *
 * WHY IT LIVES IN THE LAYOUT: this used to be a setInterval inside the dashboard's
 * WorkTracker card, so walking to Pipeline or Finance unmounted the component and
 * silently stopped the clock. The widget therefore measured "time spent looking at
 * the dashboard", not work time. A layout-mounted component survives every
 * client-side navigation within (app), so the clock runs wherever you are.
 *
 * COUNTING RULE: any open tab counts, visible or not, until it is closed.
 *
 * WHY A LEADER LOCK: with no visibility gating, three open tabs would each report
 * a second per second and treble the day. Tabs elect one leader through
 * localStorage; only the leader accrues. The others just listen, so their widgets
 * still show a live clock.
 *
 * WHY WALL-CLOCK DELTAS, NOT TICK COUNTING: browsers throttle timers in background
 * tabs to roughly one fire per minute. Counting "one second per tick" would lose
 * almost everything the moment the tab lost focus, which is precisely the case this
 * rule is meant to capture. Each tick banks the real elapsed time instead.
 */

const LOCK_KEY = "b2-worktime-leader";
const CHANNEL = "b2-work-time";

const TICK_MS = 15_000; // bank elapsed time this often
const FLUSH_MS = 30_000; // heartbeat to the server this often
const LOCK_STALE_MS = 45_000; // a leader silent this long is presumed gone

/** A tick longer than this means the machine slept — don't bank the nap. */
const MAX_TICK_SEC = 300;

type Lock = { id: string; ts: number };

export function WorkTimeTracker() {
  useEffect(() => {
    const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let pending = 0; // seconds banked locally, not yet accepted by the server
    let lastTick = Date.now();
    let lastFlush = Date.now();
    let inFlight = false;
    let stopped = false;

    const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;

    /** Tell this tab's widget, and every other tab, the authoritative total. */
    const publish = (todaySec: number) => {
      window.dispatchEvent(new CustomEvent("b2-work-time", { detail: { todaySec } }));
      channel?.postMessage({ todaySec });
    };

    const readLock = (): Lock | null => {
      try {
        const raw = localStorage.getItem(LOCK_KEY);
        return raw ? (JSON.parse(raw) as Lock) : null;
      } catch {
        return null;
      }
    };

    /** Claim or renew leadership. Returns true if this tab may accrue. */
    const isLeader = (): boolean => {
      const now = Date.now();
      const lock = readLock();
      const mine = lock?.id === tabId;
      const stale = !lock || now - lock.ts > LOCK_STALE_MS;
      if (!mine && !stale) return false;
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify({ id: tabId, ts: now } satisfies Lock));
      } catch {
        // Private mode with storage disabled: fall back to accruing. A duplicate
        // tab over-counting beats a tab that never counts at all.
        return true;
      }
      return true;
    };

    const flush = async (force = false) => {
      if (stopped || inFlight) return;
      const seconds = Math.floor(pending);
      if (seconds < 1) return;
      if (!force && Date.now() - lastFlush < FLUSH_MS) return;

      inFlight = true;
      pending -= seconds; // optimistic: re-added below if the post fails
      lastFlush = Date.now();
      try {
        const res = await fetch("/api/work-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds }),
          keepalive: true,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { todaySec?: number | null };
        if (typeof data.todaySec === "number") publish(data.todaySec);
      } catch {
        // Offline or a failed request: put the seconds back so the next
        // heartbeat carries them. Nothing is lost short of closing the tab.
        pending += seconds;
      } finally {
        inFlight = false;
      }
    };

    const tick = () => {
      const now = Date.now();
      const elapsed = (now - lastTick) / 1000;
      lastTick = now;
      if (elapsed > 0 && elapsed <= MAX_TICK_SEC && isLeader()) pending += elapsed;
      void flush();
    };

    const timer = setInterval(tick, TICK_MS);

    /**
     * Last chance to save on close. fetch(keepalive) is unreliable during unload,
     * so hand the remainder to sendBeacon, which the browser delivers after the
     * page is gone. Type is text/plain to stay a CORS-simple request.
     */
    const onLeave = () => {
      const seconds = Math.floor(pending);
      if (seconds < 1) return;
      const ok = navigator.sendBeacon?.(
        "/api/work-time",
        new Blob([JSON.stringify({ seconds })], { type: "text/plain" }),
      );
      if (ok) pending -= seconds;
    };
    const onHide = () => {
      // Not a pause — just a good moment to bank what's accrued, since a hidden
      // tab may be discarded by the browser without ever firing pagehide.
      if (document.visibilityState === "hidden") {
        tick();
        onLeave();
      }
    };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHide);

    // Seed the widget with the server's totals on mount.
    void (async () => {
      try {
        const res = await fetch("/api/work-time", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { byDay?: Record<string, number>; todaySec?: number };
        window.dispatchEvent(
          new CustomEvent("b2-work-time", {
            detail: { todaySec: data.todaySec ?? 0, byDay: data.byDay ?? {} },
          }),
        );
      } catch {
        /* widget keeps its server-rendered values */
      }
    })();

    channel?.addEventListener("message", (e: MessageEvent) => {
      const sec = (e.data as { todaySec?: number } | null)?.todaySec;
      if (typeof sec === "number") {
        window.dispatchEvent(new CustomEvent("b2-work-time", { detail: { todaySec: sec } }));
      }
    });

    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onHide);
      // Bank the final partial interval BEFORE the stop flag, then beacon it —
      // otherwise signing out drops up to 15s and, worse, leaves the lock held.
      tick();
      stopped = true;
      onLeave();
      try {
        if (readLock()?.id === tabId) localStorage.removeItem(LOCK_KEY);
      } catch {
        /* nothing to release */
      }
      channel?.close();
    };
  }, []);

  return null;
}
