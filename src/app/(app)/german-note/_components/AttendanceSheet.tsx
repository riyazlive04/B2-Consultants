"use client";

import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { loadAttendanceSheet, markAttendance } from "@/server/attendance-actions";
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

  useEffect(() => {
    if (!open) return;
    // Guards against a modal closed (or switched to another session) mid-fetch resolving into
    // state that no longer belongs to it.
    let cancelled = false;
    setLoading(true);
    setError(null);
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
          <div className="flex flex-wrap items-center gap-3">
            <Btn
              variant="secondary"
              onClick={() =>
                setDraft(Object.fromEntries(rows.map((r) => [r.studentId, "PRESENT" as const])))
              }
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
                  <span className="block truncate text-sm font-medium text-ink">{r.studentName}</span>
                  {r.studentCode && (
                    <span className="block text-caption tabular-nums text-muted">{r.studentCode}</span>
                  )}
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
                        onClick={() =>
                          // Clicking the active button CLEARS it. That is the only way to get
                          // back to "not marked", which is a real state - see the note in
                          // server/attendance.ts on why an empty row differs from ABSENT.
                          setDraft((d) => ({ ...d, [r.studentId]: active ? null : s }))
                        }
                      >
                        {ATTENDANCE_STATUS_LABELS[s]}
                      </button>
                    );
                  })}
                </span>
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
