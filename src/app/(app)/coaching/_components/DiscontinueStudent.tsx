"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinus, Undo2 } from "lucide-react";
import { discontinueEnrollment, restoreEnrollment } from "@/server/students-actions";
import { OTHER_REASON } from "@/lib/enrollment-lifecycle";
import { Field, Select, TextArea } from "@/components/ui/form";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";

/**
 * THE DISCONTINUE BUTTON (@37:54-39:42), and its undo.
 *
 * ── Why it asks rather than confirms ───────────────────────────────────────────────────
 * `askConfirm` would have been one line, and it would have produced exactly the churn report
 * the founders already have: a count with no reasons in it. The reason is the feature. So this
 * is a small form, the reason is required, and the vocabulary comes from the Console rather than
 * from here - the question "why do students leave us" has a different answer every quarter and
 * the picker has to be able to follow it.
 *
 * ── Why the move is manual, and stays manual ───────────────────────────────────────────
 * Nothing in the app discontinues a student by itself. The founders were explicit on that
 * (@37:54), and the student-side follow-up ladder only ever SURFACES a candidate to the coach.
 * A programme ending is a conversation someone has had; the app records it afterwards.
 *
 * ── Why restore is a plain confirm and this is not ─────────────────────────────────────
 * Putting a student back needs no new information - it reinstates what was there - so it asks
 * once and does it. Ending a programme needs a reason that will be read in a report months
 * later, which no confirm dialog can collect.
 */
export function DiscontinueButton({
  enrollmentId,
  studentName,
  reasons,
  allowOther,
}: {
  enrollmentId: string;
  studentName: string;
  reasons: string[];
  allowOther: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNote = reason === OTHER_REASON;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("reason", reason);
    fd.set("note", note);
    const res = await safeAction(() => discontinueEnrollment(enrollmentId, fd));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    setReason("");
    setNote("");
    /*
      Deliberately NOT `toastUndo`. The undo pattern is for a reversal that needs no thought -
      a soft delete, a filter change. Putting a student back onto a programme is a decision
      about a person, and it belongs on the "Recently stopped" list below with the reason next
      to it, where whoever reverses it can see what they are reversing.
    */
    toast(`${studentName} marked as discontinued`);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex h-8 items-center gap-1 rounded-field px-2 text-caption font-semibold text-ink-2 hover:bg-surface-2 hover:text-risk"
      >
        <UserMinus size={13} aria-hidden />
        Discontinue
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Discontinue ${studentName}`}
        subtitle="This takes them off your caseload, the register and the leaderboard. It does not change what they owe."
        size="sm"
      >
        <div className="space-y-4">
          <Field
            label="Why are they stopping?"
            required
            hint="This is what the churn breakdown totals, so pick the closest one rather than Other where you can."
          >
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Pick a reason"
              options={[
                ...reasons.map((r) => ({ value: r, label: r })),
                ...(allowOther ? [{ value: OTHER_REASON, label: "Other - let me type it" }] : []),
              ]}
              aria-label="Why the student is stopping"
            />
          </Field>

          <Field
            label={needsNote ? "What was the reason?" : "Anything to add (optional)"}
            required={needsNote}
            hint={
              needsNote
                ? "Kept as the reason itself, so write it as you would want to read it in a report."
                : "Context for whoever reads this later - what was said, what was tried."
            }
          >
            <TextArea
              kind="text"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={needsNote ? "e.g. Moved to a different field entirely" : ""}
            />
          </Field>

          {/*
            Said here rather than left to be discovered. A coach pressing this button is
            reasonably worried they are cancelling an invoice, and §8 of the agreement says
            otherwise - so the screen says otherwise too, next to the button.
          */}
          <p className="rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-ink-2">
            Their instalments stay owed and the payment reminders keep running. Discontinuing is
            not a refund - raise that with Finance separately if it has been agreed.
          </p>

          {error && <p className="text-caption font-medium text-risk">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Btn>
            {/*
              `Btn`, not the kit's `SubmitButton`: that one reads `useFormStatus`, so it only
              knows it is working inside a real <form> action. This dialog calls the server
              action directly and owns its own `busy`. `danger` is the shared destructive fill -
              hand-rolling one here is how a second red gets into the system.
            */}
            <Btn
              variant="danger"
              onClick={submit}
              busy={busy}
              disabled={!reason || (needsNote && !note.trim())}
              title={!reason ? "Pick a reason first" : undefined}
            >
              Discontinue
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function RestoreButton({
  enrollmentId,
  studentName,
}: {
  enrollmentId: string;
  studentName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const ok = await askConfirm({
      title: `Put ${studentName} back?`,
      body: "They return to your caseload, the register and the leaderboard, and the reason they stopped is cleared.",
      confirmLabel: "Put them back",
    });
    if (!ok) return;
    setBusy(true);
    const res = await safeAction(() => restoreEnrollment(enrollmentId));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(`${studentName} is back on their programme`);
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="press inline-flex h-8 items-center gap-1 rounded-field px-2 text-caption font-semibold text-primary hover:bg-surface-2 disabled:opacity-60"
    >
      <Undo2 size={13} aria-hidden />
      {busy ? "Putting back…" : "Put back"}
    </button>
  );
}
