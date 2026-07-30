"use client";

import { useCallback, useEffect, useState } from "react";
import { syncOfflineCalls } from "@/server/offline-call-sync";
import { isExhausted, type QueuedCall } from "@/lib/offline-calls";
import {
  bumpAttempts,
  dequeueCalls,
  enqueueCall,
  listQueuedCalls,
  newClientKey,
} from "@/lib/offline-queue-store";

/**
 * The offline call queue, as a hook.
 *
 * Flushes on three triggers, because no single one is sufficient:
 *   • the browser's `online` event — the obvious case, signal returns while the tab is open;
 *   • mount — the tab was closed and reopened with entries still queued from last time;
 *   • a slow timer — `online` lies. It fires when the OS gets *an* interface, which on a
 *     phone means a wifi network you have not authenticated to yet, so the first flush after
 *     it can still fail. The timer is the backstop that eventually gets them through.
 *
 * `navigator.onLine` is only ever used to SKIP obviously-doomed work and to render the
 * indicator. It is never trusted as proof of connectivity — a false `true` is common, so the
 * real test is whether the server action resolves.
 */

export type OfflineState = {
  /** Entries still on the device. */
  pending: number;
  /** Entries that have failed too many times and need a human. */
  stuck: number;
  online: boolean;
  syncing: boolean;
};

export function useOfflineCalls(onSynced?: () => void) {
  const [state, setState] = useState<OfflineState>({
    // Start optimistic and correct it on mount: `navigator` does not exist during SSR, and
    // reading it in the initial state would render a different tree on server and client.
    pending: 0, stuck: 0, online: true, syncing: false,
  });

  const refresh = useCallback(async () => {
    const q = await listQueuedCalls();
    setState((s) => ({
      ...s,
      pending: q.length,
      stuck: q.filter(isExhausted).length,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    }));
  }, []);

  const flush = useCallback(async () => {
    const queue = await listQueuedCalls();
    const sendable = queue.filter((e) => !isExhausted(e));
    if (sendable.length === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    setState((s) => ({ ...s, syncing: true }));
    try {
      const res = await syncOfflineCalls(
        JSON.stringify({
          entries: sendable.map(({ clientKey, leadId, outcome, notes, recordedAt }) => ({
            clientKey, leadId, outcome, notes, recordedAt,
          })),
        }),
      );

      if (!res.ok) {
        await bumpAttempts(sendable);
        return;
      }

      // "duplicate" clears too — the row is already on the server, which is the outcome the
      // device wanted. Only a rejection keeps its entry, so it can be counted and retired.
      const done = res.results.filter((r) => r.status !== "rejected").map((r) => r.clientKey);
      await dequeueCalls(done);

      const rejected = sendable.filter((e) => !done.includes(e.clientKey));
      if (rejected.length) await bumpAttempts(rejected);
      if (done.length) onSynced?.();
    } catch {
      // Offline, or the action never resolved. The queue is untouched, so nothing is lost;
      // the attempt counter moves so a permanently-failing entry can't retry forever.
      await bumpAttempts(sendable);
    } finally {
      setState((s) => ({ ...s, syncing: false }));
      await refresh();
    }
  }, [onSynced, refresh]);

  /** Record a call. Goes straight to the device queue; the flush decides when it travels. */
  const queueCall = useCallback(
    async (leadId: string, outcome: string, notes: string): Promise<boolean> => {
      const entry: QueuedCall = {
        clientKey: newClientKey(),
        leadId,
        outcome,
        notes,
        recordedAt: new Date().toISOString(),
        attempts: 0,
      };
      const stored = await enqueueCall(entry);
      await refresh();
      // Try immediately — when there IS a connection this makes the offline path behave
      // exactly like the online one, so there is only one code path to trust.
      if (stored) void flush();
      return stored;
    },
    [flush, refresh],
  );

  useEffect(() => {
    void refresh();
    void flush();

    const onOnline = () => {
      void refresh();
      void flush();
    };
    const onOffline = () => void refresh();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // The backstop for `online` firing before the connection is genuinely usable.
    const timer = setInterval(() => void flush(), 60_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [flush, refresh]);

  return { ...state, queueCall, flush };
}
