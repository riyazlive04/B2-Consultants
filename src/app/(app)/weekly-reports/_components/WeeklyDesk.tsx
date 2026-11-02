"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Send, ShieldOff } from "lucide-react";
import { Card, EmptyState, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { Modal } from "@/components/ui/Modal";
import { Field, TextArea, SubmitButton, FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";
import {
  WEEKLY_FLAG_LABELS,
  WEEKLY_FLAG_TONE,
  type WeeklyFlagValue,
} from "@/lib/weekly-flags";
import type { WeeklyBoard, WeeklyStudentRow } from "@/server/weekly-report-board";
import {
  openWeeklyCycle,
  saveWeeklyReview,
  sendWeeklyReportLink,
  setCohortWeeklyTemplate,
  setWeeklyCycleState,
} from "@/server/weekly-report-actions";

/**
 * THIS WEEK - the Sprint Tracker tab, with the arithmetic done.
 *
 * One row per student. The left of the row is what they said; the right is what the delivery
 * person says about it, which is the same split the founders' sheet had between columns F-L
 * and columns M-P.
 *
 * ── The flag shows its working ────────────────────────────────────────────────────────
 * Never a bare colour. Every flag carries its reasons, because a tutor who sees "Red" and
 * cannot see why has to go and re-derive it - which is the manual Monday this screen exists
 * to remove. It is also DESIGN_SYSTEM §7: signal is never colour alone.
 *
 * ── An override is shown as an override ───────────────────────────────────────────────
 * When somebody has set the flag by hand, the derived verdict stays visible underneath. A
 * screen that quietly replaced one with the other would make the rules unfalsifiable: nobody
 * could tell whether the engine agreed.
 */

const ACTION_LABELS: Record<string, string> = {
  NONE: "No action",
  MESSAGE_SENT: "Message sent",
  CALL_SCHEDULED: "Call scheduled",
  ESCALATED: "Escalated to the founder",
};

/** A dash, not a zero: a dash means nobody asked, and zero is a real and serious answer. */
function metric(row: WeeklyStudentRow, key: keyof WeeklyStudentRow["metrics"]): string {
  const v = row.metrics[key];
  return typeof v === "number" ? String(v) : "-";
}

export function WeeklyDesk({ board }: { board: WeeklyBoard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<WeeklyStudentRow | null>(null);

  const cycle = board.cycle;

  function go(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    sp.set("tab", "0");
    if (board.selected) sp.set("batch", board.selected.batchId);
    if (cycle) sp.set("week", cycle.isoWeek);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`/weekly-reports?${sp.toString()}`);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast(success);
      else toast(res.error ?? "That did not work.", "error");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="block text-label font-semibold uppercase text-ink-2">Cohort</label>
            <div className="mt-1.5">
              <SelectMenu
                aria-label="Cohort"
                value={board.selected?.batchId ?? ""}
                onChange={(e) => go({ batch: e.currentTarget.value, week: undefined })}
                options={board.cohorts.map((c) => ({
                  value: c.batchId,
                  label: c.code ? `${c.code} · ${c.name}` : c.name,
                }))}
              />
            </div>
          </div>

          <div className="min-w-[200px] flex-1">
            <label className="block text-label font-semibold uppercase text-ink-2">Week</label>
            <div className="mt-1.5">
              <SelectMenu
                aria-label="Week"
                value={cycle?.isoWeek ?? ""}
                placeholder={board.weeks.length === 0 ? "No weeks yet" : undefined}
                disabled={board.weeks.length === 0}
                onChange={(e) => go({ week: e.currentTarget.value })}
                options={board.weeks.map((w) => ({
                  value: w.isoWeek,
                  label: `${w.batchWeekNumber !== null ? `Week ${w.batchWeekNumber} · ` : ""}${formatDate(w.weekStart)} - ${formatDate(w.weekEnd)}${w.status === "CLOSED" ? " (closed)" : ""}`,
                }))}
              />
            </div>
          </div>

          {/*
            Cohorts are not interchangeable - two on the same level can be running different
            activities - so the question set is a per-cohort choice. It takes effect on the
            NEXT week opened: a cycle pins the set it was opened with, so answers already
            given keep reading against the questions that were actually asked.
          */}
          {board.canManage && board.selected && (
            <div className="min-w-[200px] flex-1">
              <label className="block text-label font-semibold uppercase text-ink-2">Question set</label>
              <div className="mt-1.5">
                <SelectMenu
                  aria-label="Question set for this cohort"
                  value={board.selected.weeklyTemplateId ?? ""}
                  onChange={(e) =>
                    run(
                      () =>
                        setCohortWeeklyTemplate({
                          batchId: board.selected!.batchId,
                          templateId: e.currentTarget.value,
                        }),
                      "This cohort's question set is set. It applies to the next week you open.",
                    )
                  }
                  options={[
                    { value: "", label: "Default for this line and level" },
                    ...board.templates
                      .filter((t) => t.line === board.selected!.line)
                      .map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </div>
            </div>
          )}

          {board.canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {!cycle || cycle.status === "CLOSED" ? (
                <Btn
                  variant="primary"
                  busy={pending}
                  onClick={() =>
                    run(
                      () => openWeeklyCycle({ batchId: board.selected!.batchId }),
                      "This week is open. Ask the cohort when you are ready.",
                    )
                  }
                >
                  Open this week
                </Btn>
              ) : (
                <>
                  <Btn
                    variant="primary"
                    icon={<Send size={15} />}
                    busy={pending}
                    onClick={() =>
                      run(
                        () => sendWeeklyReportLink({ cycleId: cycle.id, audience: "all" }),
                        "The cohort has been asked - the message points each student at their own dashboard.",
                      )
                    }
                  >
                    {cycle.sentAt ? "Ask again" : "Ask the cohort"}
                  </Btn>
                  <Btn
                    busy={pending}
                    onClick={() =>
                      run(
                        () => sendWeeklyReportLink({ cycleId: cycle.id, audience: "pending" }),
                        "Chased everyone who has not answered.",
                      )
                    }
                  >
                    Remind non-responders
                  </Btn>
                </>
              )}
            </div>
          )}
        </div>

        {cycle && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-caption text-muted">
            <Pill tone={cycle.status === "OPEN" ? "good" : "neutral"}>
              {cycle.status === "OPEN" ? "Open" : "Closed"}
            </Pill>
            <span>
              Closes {formatDate(cycle.closesAt)} · {cycle.sentAt ? `asked ${formatDate(cycle.sentAt)}` : "cohort not asked yet"}
            </span>
            {board.canManage && cycle.status === "OPEN" && (
              <button
                type="button"
                className="press inline-flex items-center gap-1 rounded-pill border border-line px-2 py-1 font-medium text-ink hover:border-primary-tint"
                onClick={() =>
                  run(
                    () => setWeeklyCycleState({ cycleId: cycle.id, state: "CLOSED" }),
                    "This week is closed.",
                  )
                }
              >
                <Clock size={12} aria-hidden /> Close early
              </button>
            )}
          </div>
        )}
      </Card>

      {/*
        The quiet failure this screen can have: the report is answered in the portal and
        nowhere else, so a student whose record has no login attached cannot answer at all -
        and the only symptom is a week with no submission, which looks exactly like a student
        ignoring you. Said here, before the week goes out, rather than guessed at afterwards.
      */}
      {board.totals.withoutLogin > 0 && (
        <div className="rounded-card border border-warn-soft bg-warn-soft/40 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldOff size={15} className="shrink-0 text-warn" aria-hidden />
            {board.totals.withoutLogin === board.totals.roster
              ? "Nobody on this cohort can fill the form in yet"
              : `${board.totals.withoutLogin} student${board.totals.withoutLogin === 1 ? "" : "s"} cannot fill the form in`}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            The report is filled in on the student&apos;s own dashboard, and
            {board.totals.withoutLogin === 1 ? " one of them has" : " these students have"} no
            portal login yet. Send their login from the student&apos;s record and they can
            answer straight away.
          </p>
        </div>
      )}

      {!cycle ? (
        <EmptyState
          title="This cohort has not been asked yet"
          body="No weekly report has ever been opened for this cohort. Opening one puts the form on every student's own dashboard, and lets you message them to say it is waiting."
          action={
            board.canManage ? (
              <Btn
                variant="primary"
                busy={pending}
                onClick={() =>
                  run(
                    () => openWeeklyCycle({ batchId: board.selected!.batchId }),
                    "This week is open.",
                  )
                }
              >
                Open this week
              </Btn>
            ) : undefined
          }
        />
      ) : board.rows.length === 0 ? (
        <EmptyState
          title="Nobody is seated on this cohort"
          body="There is no roster to ask. Seat students on the cohort first and the week will fill itself."
        />
      ) : (
        <TableShell
          minWidth={980}
          head={
            <>
              <Th>Student</Th>
              <Th>Report</Th>
              <Th align="right">Apps</Th>
              <Th align="right">Interviews</Th>
              <Th align="right">Network</Th>
              <Th align="right">Posts</Th>
              <Th>What they said</Th>
              <Th>Flag</Th>
              <Th>Review</Th>
            </>
          }
        >
          {board.rows.map((row) => (
            <Tr key={row.studentId}>
              <Td>
                <span className="font-medium text-ink">{row.name}</span>
                {row.code && <span className="block text-caption text-muted">{row.code}</span>}
              </Td>
              <Td>
                {row.submitted ? (
                  <Pill tone={row.late ? "warn" : "good"}>{row.late ? "Late" : "In"}</Pill>
                ) : (
                  <Pill tone="bad">Missing</Pill>
                )}
                {row.rollup.streak > 1 && (
                  <span className="block text-caption text-muted">{row.rollup.streak}-week streak</span>
                )}
                {row.rollup.weeksSilent > 0 && (
                  <span className="block text-caption text-muted">
                    Silent {row.rollup.weeksSilent} week{row.rollup.weeksSilent === 1 ? "" : "s"}
                  </span>
                )}
              </Td>
              <Td align="right" className="tnum">{metric(row, "APPLICATIONS")}</Td>
              <Td align="right" className="tnum">{metric(row, "INTERVIEWS")}</Td>
              <Td align="right" className="tnum">{metric(row, "NETWORKING")}</Td>
              <Td align="right" className="tnum">{metric(row, "LINKEDIN_POSTS")}</Td>
              <Td>
                {row.notes.length === 0 ? (
                  <span className="text-muted">-</span>
                ) : (
                  <ul className="space-y-0.5">
                    {row.notes.map((n) => (
                      <li key={n.label} className="text-caption text-ink-2">
                        {n.value}
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
              <Td>
                <Pill tone={WEEKLY_FLAG_TONE[row.rollup.flag]}>
                  {WEEKLY_FLAG_LABELS[row.rollup.flag]}
                </Pill>
                <ul className="mt-1 space-y-0.5">
                  {row.rollup.reasons.slice(0, 3).map((r) => (
                    <li key={r.code} className="text-caption text-muted">
                      {r.label}
                    </li>
                  ))}
                </ul>
              </Td>
              <Td>
                {row.review ? (
                  <div className="space-y-0.5">
                    <span className="block text-caption font-medium text-ink">
                      {ACTION_LABELS[row.review.action] ?? row.review.action}
                      {row.review.followUpNeeded ? " · follow up" : ""}
                    </span>
                    {row.review.note && (
                      <span className="block text-caption text-muted">{row.review.note}</span>
                    )}
                    <span className="block text-caption text-ink-3">
                      {row.review.reviewedByName}, {formatDate(row.review.reviewedAt)}
                    </span>
                  </div>
                ) : (
                  <span className="text-caption text-muted">Not reviewed</span>
                )}
                {board.canManage && (
                  <Btn size="sm" onClick={() => setEditing(row)}>
                    {row.review ? "Edit" : "Review"}
                  </Btn>
                )}
              </Td>
            </Tr>
          ))}
        </TableShell>
      )}

      {editing && cycle && (
        <ReviewModal
          row={editing}
          cycleId={cycle.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({
  row,
  cycleId,
  onClose,
  onSaved,
}: {
  row: WeeklyStudentRow;
  cycleId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function save(form: FormData) {
    setError(null);
    const res = await saveWeeklyReview({
      cycleId,
      studentId: row.studentId,
      flag: String(form.get("flag") ?? ""),
      action: String(form.get("action") ?? "NONE"),
      followUpNeeded: String(form.get("followUpNeeded") ?? "no"),
      shareWithStudent: String(form.get("shareWithStudent") ?? "no"),
      note: String(form.get("note") ?? ""),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`${row.name} - this week`}>
      <form ref={formRef} action={save} className="space-y-4">
        <p className="rounded-field bg-surface-2 px-3 py-2 text-caption text-ink-2">
          The rules make this week{" "}
          <strong className="text-ink">{WEEKLY_FLAG_LABELS[row.rollup.rows.at(-1)?.weekFlag ?? "GREEN"]}</strong>
          {row.rollup.reasons.length > 0 && <> - {row.rollup.reasons.map((r) => r.label).join("; ")}.</>}
        </p>

        <FormError message={error} />

        <Field
          label="Flag"
          hint="Leave on 'Use the derived flag' unless you disagree with the rules. Setting one by hand overrides them for this week only."
        >
          <SelectMenu
            name="flag"
            defaultValue={row.review?.flag ?? ""}
            options={[
              { value: "", label: "Use the derived flag" },
              ...(["GREEN", "YELLOW", "RED"] as WeeklyFlagValue[]).map((f) => ({
                value: f,
                label: WEEKLY_FLAG_LABELS[f],
              })),
            ]}
          />
        </Field>

        <Field label="What did you do about it?">
          <SelectMenu
            name="action"
            defaultValue={row.review?.action ?? "NONE"}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>

        <Field label="Follow up needed?">
          <SelectMenu
            name="followUpNeeded"
            defaultValue={row.review?.followUpNeeded ? "yes" : "no"}
            options={[
              { value: "no", label: "No" },
              { value: "yes", label: "Yes - chase again" },
            ]}
          />
        </Field>

        <Field label="Note" hint="What the delivery team needs to remember about this week.">
          <TextArea name="note" rows={3} defaultValue={row.review?.note ?? ""} />
        </Field>

        <Field
          label="Show this note to the student?"
          hint="Off by default. A remark written for the delivery team is not automatically a remark written for the student."
        >
          <SelectMenu
            name="shareWithStudent"
            defaultValue={row.review?.shareWithStudent ? "yes" : "no"}
            options={[
              { value: "no", label: "No - staff only" },
              { value: "yes", label: "Yes - show it on their journey page" },
            ]}
          />
        </Field>

        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <SubmitButton>
            <Check size={15} /> Save review
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
