"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCheck, Hand, MessageCircleQuestion, Radio, ShieldCheck, Timer } from "lucide-react";
import { countdownLabel } from "@/lib/attendance-window";
import { Pill } from "@/components/ui/kit";
import {
  askAbsenceReason,
  excuseAbsence,
  loadAttendanceSheet,
  markAttendance,
} from "@/server/attendance-actions";
import type { AttendanceSheet as Sheet } from "@/server/attendance";
import type { AttendanceStatus } from "@/lib/attendance";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";

/**
 * The register for one class.
 *
 * DESIGNED AROUND THE ONE INTERACTION A TUTOR WILL ACTUALLY DO: press "all present", then
 * correct the two or three exceptions. A per-student dropdown that starts empty is technically
 * more neutral and would be left blank every week - an attendance feature nobody fills in
 * produces exactly the data we have today, which is none.
 *
 * The sheet is fetched on OPEN rather than shipped with the page. A batch's calendar holds dozens
 * of sessions and only one register is ever open at a time.
 */

const STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "EXCUSED"];

const STATUS_CLS: Record<AttendanceStatus, string> = {
  PRESENT: "bg-good-soft text-good border-good/30",
  LATE: "bg-warn-soft text-warn border-warn/30",
  ABSENT: "bg-bad-soft text-bad border-bad/30",
  EXCUSED: "bg-surface-2 text-ink-2 border-line-strong",
};

export function AttendanceSheetModal({
  sessionId,
  sessionTitle,
  open,
  onClose,
  onSaved,
}: {
  sessionId: string;
  sessionTitle: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus | null>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Rows the tutor has touched in this sitting - the thing that makes live polling safe.
   *
   * While the window is open, arrivals are landing from other people's phones, so an open
   * sheet has to keep re-reading the server or it would show the room as it was when the
   * modal opened. But a blind re-read would also overwrite the three rows the tutor has just
   * set and not yet saved. So the poll merges: the server wins on rows nobody has touched,
   * the tutor wins on rows they have. A ref rather than state because it must not itself
   * trigger a render.
   */
  const touched = useRef<Set<string>>(new Set());
  /** Which row is mid-request - the ask/excuse buttons are per student, not per sheet. */
  const [busyRow, setBusyRow] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Guards against a modal closed (or switched to another session) mid-fetch resolving into
    // state that no longer belongs to it.
    let cancelled = false;
    setLoading(true);
    setError(null);
    touched.current = new Set();
    loadAttendanceSheet(sessionId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setSheet(res.sheet);
      setDraft(Object.fromEntries(res.sheet.rows.map((r) => [r.studentId, r.status])));
    });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const windowOpen = sheet?.window.state === "OPEN";

  // Live arrivals while the window is open. Merged, never overwritten - see `touched` above.
  useEffect(() => {
    if (!open || !windowOpen) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const res = await loadAttendanceSheet(sessionId);
      if (cancelled || !res.ok) return;
      setSheet(res.sheet);
      setDraft((prev) =>
        Object.fromEntries(
          res.sheet.rows.map((r) => [
            r.studentId,
            touched.current.has(r.studentId) ? prev[r.studentId] ?? null : r.status,
          ]),
        ),
      );
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, windowOpen, sessionId]);

  const rows = sheet?.rows ?? [];
  const markedCount = rows.filter((r) => draft[r.studentId] != null).length;

  async function save() {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    const res = await markAttendance({
      sessionId,
      marks: rows.map((r) => ({ studentId: r.studentId, status: draft[r.studentId] ?? null })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Attendance saved");
    onSaved();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Attendance - ${sessionTitle}`} size="md">
      {loading && <p className="py-6 text-center text-sm text-muted">Loading the register…</p>}

      {!loading && error && !sheet && <FormError message={error} />}

      {!loading && sheet && rows.length === 0 && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          Nobody is on this batch&apos;s roster yet, so there is nobody to mark.
        </p>
      )}

      {!loading && sheet && rows.length > 0 && (
        <div className="space-y-4">
          {/* The window's state, so a tutor who opened the register from the desk and then
              came in here is not left guessing whether it is still running. */}
          {sheet.window.state !== "NEVER_OPENED" && (
            <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2">
              {windowOpen ? (
                <>
                  <Pill tone="warn">
                    <Radio size={12} aria-hidden /> Open
                  </Pill>
                  <Pill tone="neutral">
                    <Timer size={12} aria-hidden /> {countdownLabel(sheet.window.remainingMs)} left
                  </Pill>
                  <span className="text-caption text-muted">
                    Arrivals appear here on their own while this is open.
                  </span>
                </>
              ) : (
                <Pill tone="neutral">Window closed</Pill>
              )}
              {sheet.window.checkedInCount > 0 && (
                <Pill tone="info">
                  <Hand size={12} aria-hidden /> {sheet.window.checkedInCount} checked in
                </Pill>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Btn
              variant="secondary"
              onClick={() => {
                for (const r of rows) touched.current.add(r.studentId);
                setDraft(Object.fromEntries(rows.map((r) => [r.studentId, "PRESENT" as const])));
              }}
            >
              <CheckCheck size={15} /> Mark all present
            </Btn>
            <span className="text-xs tabular-nums text-muted">
              {markedCount} of {rows.length} marked
            </span>
          </div>

          <ul className="divide-y divide-line rounded-card border border-line">
            {rows.map((r) => (
              <li key={r.studentId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink" title={r.studentName}>{r.studentName}</span>
                  <span className="block text-caption tabular-nums text-muted">
                    {r.studentCode}
                    {/* WHOSE WORD THIS ROW IS. A tutor correcting a register needs to know
                        which marks the students made themselves - that is the difference
                        between confirming a row and overruling a person. */}
                    {r.source === "SELF" && r.checkedInAt && (
                      <span className="ml-1 font-semibold text-good">
                        {r.studentCode ? "· " : ""}checked in{" "}
                        {new Date(r.checkedInAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Kolkata",
                        })}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {STATUSES.map((s) => {
                    const active = draft[r.studentId] === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={active}
                        className={`rounded-field border px-2.5 py-1 text-xs font-semibold transition-colors ${
                          active ? STATUS_CLS[s] : "border-line text-muted hover:bg-surface-2 hover:text-ink"
                        }`}
                        onClick={() => {
                          // This row is now the tutor's: the live poll must stop overwriting it.
                          touched.current.add(r.studentId);
                          // Clicking the active button CLEARS it. That is the only way to get
                          // back to "not marked", which is a real state - see the note in
                          // server/attendance.ts on why an empty row differs from ABSENT.
                          setDraft((d) => ({ ...d, [r.studentId]: active ? null : s }));
                        }}
                      >
                        {ATTENDANCE_STATUS_LABELS[s]}
                      </button>
                    );
                  })}
                </span>

                {/*
                  ── WHY THEY MISSED IT ──
                  Offered only on a SAVED absence, and only one press: "Ask why". There is no
                  standing reason box in the student portal, which is the founders' instruction
                  - capture it only when nudged. A box on every missed class is a form nobody
                  fills in, and the silence it produces reads exactly like not caring.

                  The answer, when it comes, appears right here beside the mark it explains,
                  with "Excuse" next to it - because that is the decision the answer exists to
                  inform, and making the coach reopen the register to act on what they just
                  read is how a reason box becomes something nobody asks for.
                */}
                {r.status === "ABSENT" && draft[r.studentId] === "ABSENT" && (
                  <span className="w-full pl-1 pt-1">
                    {r.reason ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 text-caption text-ink-2">
                          <span className="font-semibold text-ink">They said:</span> “{r.reason}”
                        </span>
                        <Btn
                          size="sm"
                          variant="outline"
                          icon={<ShieldCheck size={13} />}
                          busy={busyRow === r.studentId}
                          onClick={async () => {
                            setBusyRow(r.studentId);
                            const res = await excuseAbsence({ sessionId, studentId: r.studentId });
                            setBusyRow(null);
                            if (!res.ok) return setError(res.error);
                            toast("Excused - it no longer counts against them.");
                            onSaved();
                            onClose();
                          }}
                        >
                          Excuse
                        </Btn>
                      </span>
                    ) : r.reasonAskedAt ? (
                      <span className="text-caption text-muted">
                        Asked - waiting for their answer.
                      </span>
                    ) : (
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon={<MessageCircleQuestion size={13} />}
                        busy={busyRow === r.studentId}
                        onClick={async () => {
                          setBusyRow(r.studentId);
                          const res = await askAbsenceReason({ sessionId, studentId: r.studentId });
                          setBusyRow(null);
                          if (!res.ok) return setError(res.error);
                          toast("Asked - they will see it on their dashboard.");
                          const again = await loadAttendanceSheet(sessionId);
                          if (again.ok) setSheet(again.sheet);
                        }}
                      >
                        Ask why
                      </Btn>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto">
              <Btn variant="primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save attendance"}
              </Btn>
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
