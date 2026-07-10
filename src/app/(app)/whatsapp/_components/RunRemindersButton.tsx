"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCheck } from "lucide-react";
import { toast } from "@/components/ui/feedback";
import { runRemindersNow, syncWhatsAppStatuses } from "@/server/whatsapp-actions";

/**
 * Two header actions: trigger the reminder cadence, and reconcile our statuses against WATI's own
 * log (a "Sent" row only means WATI accepted it — Meta may have rejected it afterwards).
 */
export function RunRemindersButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [, startNav] = useTransition();

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await runRemindersNow();
      toast(res.message, res.ok ? "success" : "error");
      startNav(() => router.refresh());
    } catch {
      toast("Reminder run failed", "error");
    } finally {
      setRunning(false);
    }
  };

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await syncWhatsAppStatuses();
      toast(res.message, res.ok ? "success" : "error");
      startNav(() => router.refresh());
    } catch {
      toast("Status sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        title="Ask WATI what actually happened to recent sends"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        <CheckCheck size={13} className={syncing ? "animate-pulse" : ""} />
        {syncing ? "Syncing…" : "Sync status from WATI"}
      </button>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <RefreshCw size={13} className={running ? "animate-spin" : ""} />
        {running ? "Running…" : "Run reminders now"}
      </button>
    </div>
  );
}
