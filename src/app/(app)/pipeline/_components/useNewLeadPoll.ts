"use client";

import { useEffect, useRef } from "react";

/**
 * Polls /api/leads/poll-recent every `intervalMs` and hands any newly-created leads to
 * `onNewLeads`. Follows the house pattern (NewLeadWatcher, Inbox, NotificationBell): pause
 * while the tab is hidden, and let the SERVER's clock be the cursor (echoed back as `now`)
 * so a sleeping tab or a skewed client clock can't skip or re-announce leads.
 *
 * `onNewLeads` is read through a ref rather than a dep — it's a fresh closure every render,
 * and putting it in the effect's deps would restart (and so never fire) the interval.
 */
export function useNewLeadPoll(
  scope: "table" | "kanban",
  onNewLeads: (leads: Record<string, unknown>[]) => void,
  opts?: { intervalMs?: number; enabled?: boolean },
) {
  const intervalMs = opts?.intervalMs ?? 10_000;
  const enabled = opts?.enabled ?? true;
  const cbRef = useRef(onNewLeads);
  cbRef.current = onNewLeads;
  const sinceRef = useRef(new Date().toISOString());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/api/leads/poll-recent?scope=${scope}&since=${encodeURIComponent(sinceRef.current)}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { leads: Record<string, unknown>[]; now?: string };
        if (data.now) sinceRef.current = data.now;
        if (data.leads?.length) cbRef.current(data.leads);
      } catch {
        /* transient network error — the cursor didn't move, so next tick retries this window */
      }
    };
    const t = setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [scope, intervalMs, enabled]);
}
