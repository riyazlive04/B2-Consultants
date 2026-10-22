"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Hand, Timer } from "lucide-react";
import { checkInToClass } from "@/server/attendance-checkin-actions";
import type { OpenCheckIn } from "@/server/attendance-checkin";
import { countdownLabel } from "@/lib/attendance-window";
import { Btn } from "@/components/ui/controls";
import { Pill } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";

/**
 * "ATTENDANCE IS OPEN" - the student's check-in card.
 *
 * ── Why the countdown is anchored on the client ─────────────────────────────────────────
 * The server sends `remainingMs` as it was when the page rendered, not an absolute closing
 * time, and this component turns it into a deadline at MOUNT. That is deliberate: a student's
 * phone clock can be minutes off, and a countdown computed from `closesAt` against a wrong
 * local clock would either hide a button they can still use or show one the server will
 * refuse. Anchoring on arrival means the only clock that matters is the elapsed time since the
 * page loaded, which every device agrees about.
 *
 * ── Why it hides itself at zero rather than waiting for a refresh ───────────────────────
 * The window is the promise. A button that is still there after the countdown reads 0:00 and
 * then errors is worse than no button, because the student has no way to tell whether they
 * were marked. At zero the card swaps to "Attendance has closed" and asks the server for the
 * truth, which will either confirm the check-in that landed or show the closed state.
 */
export function CheckInCard({ checkIns }: { checkIns: OpenCheckIn[] }) {
  if (checkIns.length === 0) return null;
  return (
    <div className="space-y-3">
      {checkIns.map((c) => (
        <OneCheckIn key={c.sessionId} checkIn={c} />
      ))}
    </div>
  );
}

function OneCheckIn({ checkIn }: { checkIn: OpenCheckIn }) {
  const router = useRouter();
  // Captured once per mount - see the note above. `useMemo` with an empty dep list is the
  // point here, not an optimisation.
  const deadline = useMemo(() => Date.now() + checkIn.remainingMs, [checkIn.remainingMs]);
  const [left, setLeft] = useState(checkIn.remainingMs);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(checkIn.checkedIn);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, deadline - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const expired = left <= 0;

  useEffect(() => {
    // One refresh on expiry, so the card is replaced by whatever is actually true now. The
    // guard matters: without it this would re-fire on every later render of an expired card.
    if (!expired) return;
    router.refresh();
  }, [expired, router]);

  const press = useCallback(async () => {
    setBusy(true);
    const res = await checkInToClass({ sessionId: checkIn.sessionId });
    setBusy(false);
    if (!res.ok) {
      toast(res.error, "error");
      // Whatever went wrong, the page is now out of date with the server - a tutor may have
      // marked this student by hand while the card sat open.
      router.refresh();
      return;
    }
    setDone(true);
    toast("You're marked present. See you in class.", "success");
    router.refresh();
  }, [checkIn.sessionId, router]);

  const when = checkIn.checkedInAt
    ? new Date(checkIn.checkedInAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : null;

  return (
    <section
      // A live region: a student using a screen reader needs the countdown and the outcome
      // announced, not just drawn.
      aria-live="polite"
      className="rounded-card border border-primary-tint bg-sky p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="flex items-center gap-2">
          <Hand size={18} className="text-primary" aria-hidden />
          <span className="text-label font-semibold uppercase text-ink-2">
            {expired ? "Attendance closed" : "Attendance is open"}
          </span>
        </span>

        <div className="min-w-[200px] flex-1">
          <p className="font-display text-[17px] font-semibold text-ink">{checkIn.title}</p>
          <p className="text-sm text-ink-2">
            {checkIn.batchName}
            {checkIn.framework ? ` · ${checkIn.framework}` : ""}
          </p>
        </div>

        {!expired && !done && !checkIn.markedByTutor && (
          <Pill tone={left < 60_000 ? "bad" : "warn"}>
            <Timer size={12} aria-hidden /> {countdownLabel(left)} left
          </Pill>
        )}

        {done || checkIn.checkedIn ? (
          <Pill tone="good">
            <CheckCircle2 size={12} aria-hidden />
            {when ? `Checked in at ${when}` : "Checked in"}
          </Pill>
        ) : checkIn.markedByTutor ? (
          // The tutor has already decided this one. Saying so is the whole point - a button
          // here would be a student trying to overrule their own register.
          <Pill tone="neutral">Marked by your coach</Pill>
        ) : expired ? (
          <Pill tone="neutral">Closed</Pill>
        ) : (
          <Btn variant="primary" onClick={press} busy={busy} icon={<Hand size={15} />}>
            I&apos;m here
          </Btn>
        )}

        {checkIn.joinUrl && !expired && (
          <a
            href={checkIn.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex h-10 items-center gap-1.5 rounded-btn border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary hover:text-primary"
          >
            <ExternalLink size={15} aria-hidden /> Join
          </a>
        )}
      </div>

      {!expired && !done && !checkIn.checkedIn && !checkIn.markedByTutor && (
        <p className="mt-2 text-caption text-muted">
          Tap this while you are in the class. Once the countdown runs out your coach marks the
          register by hand.
        </p>
      )}
    </section>
  );
}
