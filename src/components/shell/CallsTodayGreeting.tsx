"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";

/**
 * The "you have N calls to take today" popup, shown once a day after signing in.
 *
 * Once a DAY, not once a session: the ask was "once they log in they have to see the total
 * number of calls" — but this app keeps you signed in, so a strict once-per-login popup would
 * appear roughly never. Keying the dismissal on the IST date means it greets them the first
 * time they open the app each day and then stays out of the way, which is what was meant.
 *
 * localStorage (not sessionStorage) so it survives a tab close and doesn't re-fire in every
 * new tab. Keyed per user so a shared machine doesn't hide Asma's popup because Nilofer
 * dismissed hers.
 */
export function CallsTodayGreeting({
  userId,
  count,
  target,
  name,
  todayKey,
}: {
  userId: string;
  count: number;
  target: number;
  name: string;
  /** The IST date (YYYY-MM-DD), resolved on the server — the client's clock may be wrong. */
  todayKey: string;
}) {
  const [open, setOpen] = useState(false);
  const storageKey = `b2:calls-greeting:${userId}:${todayKey}`;

  useEffect(() => {
    // Read in an effect, never during render: localStorage doesn't exist on the server, and
    // touching it while rendering would make the markup differ between server and client.
    try {
      if (!localStorage.getItem(storageKey)) setOpen(true);
    } catch {
      /* private mode / storage disabled — just don't show it rather than breaking the shell */
    }
  }, [storageKey]);

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore — worst case it greets them again */
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal open onClose={dismiss} title={`Good day, ${name}`} size="sm">
      <div className="space-y-4">
        <div className="rounded-field bg-primary-soft px-4 py-5 text-center">
          <p className="tnum font-display text-display-l text-primary">{count}</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {count === 1 ? "call to make today" : "calls to make today"}
          </p>
          {target > 0 && (
            <p className="mt-1 text-xs text-ink-2">Your daily target is {target}</p>
          )}
        </div>
        <p className="text-sm text-muted">
          {count === 0
            ? "Nothing waiting right now — new leads will pop up the moment they're assigned to you."
            : "These are your open leads with no call logged today. Never-called leads are at the top of the list."}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Btn>
          <Link
            href="/my-desk"
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
          >
            <PhoneCall size={14} /> Open my call list
          </Link>
        </div>
      </div>
    </Modal>
  );
}
