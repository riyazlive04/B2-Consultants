"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, MessageSquare, Save } from "lucide-react";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { Field, TextArea, TextInput } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import {
  ANSWER_MAX,
  IMPROVEMENT_KIND_DEFS,
  IMPROVEMENT_STATUS_LABELS,
  IMPROVEMENT_TRANSITIONS,
  type ImprovementKind,
  type ImprovementStatus,
} from "@/lib/improvement";
import {
  archiveImprovement,
  commentOnImprovement,
  rekindImprovement,
  saveImprovementDevNote,
  setImprovementStatus,
} from "@/server/improvement-actions";

/**
 * The triage controls on one report.
 *
 * ── Only the legal moves are rendered ──────────────────────────────────────────────────────
 * The buttons come from `IMPROVEMENT_TRANSITIONS`, the same table the server refuses an illegal move
 * with. So a button that cannot work never appears, and the error path exists only for a stale
 * screen - which is the point of keeping the machine in one pure place rather than writing the
 * states into a dropdown here and the rules into the action.
 *
 * ── Two kinds of writing, kept visibly apart ───────────────────────────────────────────────
 * "Working notes" are internal. A "reply" is addressed to the person who filed the report and
 * they will read it. Letting one field be both is how a half-formed diagnosis ends up in front
 * of a student.
 */
export function ImprovementTriage({
  id,
  improvementRef,
  status,
  kind,
  devNote,
}: {
  id: string;
  improvementRef: string;
  status: ImprovementStatus;
  kind: ImprovementKind;
  devNote: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState("");
  const [duplicateOfRef, setDuplicateOfRef] = useState("");
  const [note, setNote] = useState(devNote ?? "");
  const [comment, setComment] = useState("");
  const [toReporter, setToReporter] = useState(false);

  const next = IMPROVEMENT_TRANSITIONS[status];

  async function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const res = await safeAction(work);
    setBusy(false);
    if (!res.ok) return toast(res.error ?? "That did not work", "error");
    toast(done);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-label font-semibold uppercase text-ink-3">
          Now: {IMPROVEMENT_STATUS_LABELS[status]}
        </p>
        <div className="flex flex-wrap gap-2">
          {next.map((to) => (
            <button
              key={to}
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    setImprovementStatus({
                      id,
                      to,
                      resolution: resolution.trim() || undefined,
                      duplicateOfRef: duplicateOfRef.trim() || undefined,
                    }),
                  `${improvementRef} is now ${IMPROVEMENT_STATUS_LABELS[to].toLowerCase()}`,
                )
              }
              className="press inline-flex h-9 items-center rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:cursor-not-allowed disabled:text-ink-disabled"
            >
              {IMPROVEMENT_STATUS_LABELS[to]}
            </button>
          ))}
        </div>
      </div>

      {/* Shown for every move, because the words matter most on the two that end the story:
          FIXED and DECLINED are the only things the reporter is ever told. */}
      <Field
        label="What to tell the reporter"
        hint="Optional. Sent with Fixed or Declined, and visible to them."
      >
        <TextArea
          rows={2}
          maxLength={ANSWER_MAX}
          value={resolution}
          onChange={(e) => setResolution(e.currentTarget.value)}
          placeholder="Fixed in today's deploy - the panel and the decision now read the same figure."
        />
      </Field>

      {next.includes("DUPLICATE") && (
        <Field label="Duplicate of" hint="The reference of the report this repeats">
          <TextInput
            value={duplicateOfRef}
            onChange={(e) => setDuplicateOfRef(e.currentTarget.value)}
            placeholder="IMP-0004"
            maxLength={40}
          />
        </Field>
      )}

      <Field label="Re-file as" hint="If it is not the kind the reporter picked">
        <SelectMenu
          name="kind"
          value={kind}
          onChange={(e) => {
            const to = e.currentTarget.value as ImprovementKind;
            if (to !== kind) void run(() => rekindImprovement({ id, kind: to }), `${improvementRef} re-filed`);
          }}
          options={IMPROVEMENT_KIND_DEFS.map((k) => ({ value: k.key, label: k.label }))}
        />
      </Field>

      <Field label="Working notes" hint="Internal - never shown to the reporter">
        <TextArea
          rows={3}
          maxLength={ANSWER_MAX}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </Field>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => saveImprovementDevNote({ id, devNote: note }), "Notes saved")}
        className="press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:cursor-not-allowed"
      >
        <Save size={14} /> Save notes
      </button>

      <div className="border-t border-line pt-4">
        <Field label="Add a comment">
          <TextArea
            rows={2}
            maxLength={ANSWER_MAX}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
          />
        </Field>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-caption text-ink-2">
          <input
            type="checkbox"
            checked={toReporter}
            onChange={(e) => setToReporter(e.currentTarget.checked)}
            className="accent-[var(--primary)]"
          />
          Show this to the person who reported it
        </label>
        <button
          type="button"
          disabled={busy || comment.trim().length < 2}
          onClick={() =>
            run(
              () => commentOnImprovement({ id, body: comment, visibleToReporter: toReporter }),
              "Comment added",
            ).then(() => setComment(""))
          }
          className="press mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:cursor-not-allowed disabled:text-ink-disabled"
        >
          <MessageSquare size={14} /> Comment
        </button>
      </div>

      {/* Archive, not delete - and it says so, because "Delete" would be a lie.
          `askConfirm` rather than the house `toastUndo` that soft deletes usually get: there is
          no archive view on this screen yet, so an Undo button would be the only way back and a
          toast that has already faded is not a way back. */}
      <div className="border-t border-line pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const ok = await askConfirm({
              title: `Archive ${improvementRef}?`,
              body: "It leaves the queue and stays readable in the archive. Nothing is deleted.",
              confirmLabel: "Archive",
            });
            if (ok) void run(() => archiveImprovement({ id }), `${improvementRef} archived`);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-btn px-3 text-caption font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-risk disabled:cursor-not-allowed"
        >
          <Archive size={14} /> Archive this report
        </button>
      </div>
    </div>
  );
}
