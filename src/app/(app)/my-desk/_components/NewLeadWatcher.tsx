"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneCall, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";

type PolledLead = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  leadSource: string;
  createdAt: string;
};

/**
 * "A new lead just came in" — polls /api/leads/poll every 30s and pops the leads newly
 * assigned to this person.
 *
 * Follows the house pattern (Inbox.tsx / NotificationBell): poll a small scoped endpoint
 * rather than router.refresh() on a timer, and pause while the tab is hidden so a
 * backgrounded phone isn't querying all night.
 *
 * The cursor is the SERVER's clock, echoed back as `now` — never Date.now() here. A phone
 * that slept for an hour, or whose clock is minutes off, would otherwise either miss leads
 * or re-announce old ones. The cursor only advances on a successful poll, so a failed
 * request retries the same window instead of skipping it.
 */
export function NewLeadWatcher({ onSeen }: { onSeen?: () => void }) {
  const [queue, setQueue] = useState<PolledLead[]>([]);
  const sinceRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/leads/poll?since=${encodeURIComponent(sinceRef.current)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { leads: PolledLead[]; now?: string };
        if (data.now) sinceRef.current = data.now;
        if (data.leads?.length) {
          // De-dupe by id: a lead already queued must not stack twice if a poll overlaps.
          setQueue((q) => {
            const seen = new Set(q.map((l) => l.id));
            return [...q, ...data.leads.filter((l) => !seen.has(l.id))];
          });
          onSeen?.(); // refresh the desk behind the popup so the list/counters include it
        }
      } catch {
        /* transient network error — the cursor didn't move, so next tick retries this window */
      }
    };
    const t = setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
    // onSeen is intentionally not a dep: it changes every render and would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lead = queue[0];
  if (!lead) return null;

  const dismiss = () => setQueue((q) => q.slice(1));

  return (
    <Modal open onClose={dismiss} title="New lead just came in" size="sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-field bg-primary-soft px-4 py-3">
          <Sparkles size={18} className="flex-none text-primary" />
          <div className="min-w-0">
            <p className="font-display text-h3 text-ink">{lead.name}</p>
            <p className="text-xs text-ink-2">
              {lead.phone}
              {lead.city ? ` · ${lead.city}` : ""} · {lead.leadSource}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted">
          This lead has just been assigned to you. Speed matters most in the first few minutes — call now if you can.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={dismiss}>
            Later
          </Btn>
          <a
            href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
          >
            <PhoneCall size={14} /> Call now
          </a>
        </div>
        {queue.length > 1 && (
          <p className="text-center text-xs text-muted">+{queue.length - 1} more new lead(s) behind this one</p>
        )}
      </div>
    </Modal>
  );
}
