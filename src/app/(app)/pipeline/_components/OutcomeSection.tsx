"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { createOutcome, deleteOutcome, suggestOutcomeFromNote, updateOutcome } from "@/server/pipeline-actions";
import type { OutcomeRow } from "@/server/pipeline-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { CALL_OUTCOME_LABELS, optionsFrom } from "@/lib/labels";
import {
  BANT_LABELS,
  LOW_CONFIDENCE,
  summariseExtraction,
  type BantFlags,
  type CallNoteExtraction,
} from "@/lib/call-note-extract";

/** Every field the form owns, as strings - the shape we re-seed defaults from. */
type Seed = {
  leadId: string;
  callDate: string;
  outcome: string;
  sssDate: string;
  highlyQualified: boolean;
  bantBudget: boolean;
  bantAuthority: boolean;
  bantNeed: boolean;
  bantTimeline: boolean;
  notes: string;
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const on = (fd: FormData, k: string) => fd.get(k) === "on";

function readForm(form: HTMLFormElement): Seed {
  const fd = new FormData(form);
  return {
    leadId: str(fd, "leadId"),
    callDate: str(fd, "callDate"),
    outcome: str(fd, "outcome"),
    sssDate: str(fd, "sssDate"),
    highlyQualified: on(fd, "highlyQualified"),
    bantBudget: on(fd, "bantBudget"),
    bantAuthority: on(fd, "bantAuthority"),
    bantNeed: on(fd, "bantNeed"),
    bantTimeline: on(fd, "bantTimeline"),
    notes: str(fd, "notes"),
  };
}

/**
 * Fold a suggestion into what's on screen. Three rules, and they're all about not
 * overwriting a human:
 *   - BANT ticks are only ever ADDED. If the specialist ticked Budget and the note doesn't
 *     mention money, that's their call - they were on the phone, the extractor wasn't.
 *   - the date only lands in "SSS date" when the outcome is actually a booked strategy
 *     session, and only when that field is still empty. A follow-up date is not an SSS date.
 *   - `notes` and `highlyQualified` are never touched: one is what the human typed, the
 *     other is a permissioned field (outreach.qualify) that drives commission and XP.
 */
function applySuggestion(current: Seed, x: CallNoteExtraction): Seed {
  const next: Seed = { ...current };
  if (x.outcome) next.outcome = x.outcome;
  next.bantBudget = current.bantBudget || x.bant.budget;
  next.bantAuthority = current.bantAuthority || x.bant.authority;
  next.bantNeed = current.bantNeed || x.bant.need;
  next.bantTimeline = current.bantTimeline || x.bant.timeline;
  if (x.followUpDate && x.outcome === "QUALIFIED_FOR_SSS" && !current.sssDate) {
    next.sssDate = x.followUpDate;
  }
  return next;
}

export function OutcomeSection({
  rows,
  leadOptions,
  today,
  isAdmin,
}: {
  rows: OutcomeRow[];
  leadOptions: { value: string; label: string }[];
  today: string;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<OutcomeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Extraction re-seeds the form's defaults and remounts it (see `formKey`). The fields are a
  // mix of plain inputs and stateful popovers (SelectMenu, DatePicker), so writing to the DOM
  // would update the value a form submits while leaving the visible control showing the old
  // one - remounting from new defaults is the only way all three field kinds agree.
  const [seed, setSeed] = useState<Seed | null>(null);
  const [seedNo, setSeedNo] = useState(0);
  const [suggestion, setSuggestion] = useState<{ extraction: CallNoteExtraction; fallbackReason: string | null } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const formKey = `${editing?.id ?? "new"}-${seedNo}`;
  /** Seed wins when there is one; `Seed` has no optional fields, so `undefined` means "no seed". */
  const d = <T,>(fromSeed: T | undefined, fallback: T): T => (fromSeed === undefined ? fallback : fromSeed);

  const resetForm = () => {
    setSeed(null);
    setSuggestion(null);
    formRef.current?.reset();
  };

  /** Editing a different row must not inherit the previous row's extraction. */
  const startEdit = (row: OutcomeRow) => {
    setSeed(null);
    setSuggestion(null);
    setEditing(row);
  };

  const submit = async (form: FormData) => {
    setError(null);
    const res = editing ? await updateOutcome(editing.id, form) : await createOutcome(form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Outcome updated" : "Call outcome recorded");
    setEditing(null);
    resetForm();
  };

  async function extract() {
    const form = formRef.current;
    if (!form) return;
    const current = readForm(form);
    if (!current.notes.trim()) return toast("Write the call note first", "error");

    setExtracting(true);
    const res = await suggestOutcomeFromNote({ note: current.notes, callDate: current.callDate });
    setExtracting(false);
    if (!res.ok) return toast(res.error, "error");

    setSuggestion(res.result);
    setSeed(applySuggestion(current, res.result.extraction));
    setSeedNo((n) => n + 1);
  }

  const remove = async (row: OutcomeRow) => {
    const ok = await askConfirm({
      title: `Delete this call outcome for ${row.leadName}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteOutcome(row.id);
    toast("Outcome deleted");
  };

  const columns: Column<OutcomeRow>[] = [
    { key: "lead", header: "Lead", cell: (r) => r.leadName, value: (r) => r.leadName },
    { key: "date", header: "Call date", cell: (r) => formatDate(r.callDate), value: (r) => r.callDate.slice(0, 10) },
    { key: "outcome", header: "Outcome", cell: (r) => CALL_OUTCOME_LABELS[r.outcome], value: (r) => CALL_OUTCOME_LABELS[r.outcome] },
    {
      key: "hq", header: "Highly qualified",
      cell: (r) => (r.highlyQualified ? "Yes" : "No"), value: (r) => (r.highlyQualified ? "Yes" : "No"),
    },
    {
      key: "bant", header: "BANT", align: "right",
      cell: (r) => {
        const n = [r.bantBudget, r.bantAuthority, r.bantNeed, r.bantTimeline].filter(Boolean).length;
        return n === 0 ? "-" : `${n}/4`;
      },
      value: (r) => [r.bantBudget, r.bantAuthority, r.bantNeed, r.bantTimeline].filter(Boolean).length,
    },
    { key: "sss", header: "SSS date", cell: (r) => (r.sssDate ? formatDate(r.sssDate) : "-"), value: (r) => r.sssDate?.slice(0, 10) ?? "" },
    { key: "by", header: "Entered by", cell: (r) => r.enteredBy, value: (r) => r.enteredBy },
    { key: "notes", header: "Key notes to closer", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          {isAdmin && (
            <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
          )}
        </span>
      ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      <Card
        title={editing ? `Edit outcome - ${editing.leadName}` : "Discovery call outcome"}
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(null); resetForm(); }}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={formKey}>
        {leadOptions.length === 0 ? (
          <p className="text-sm text-muted">Add a lead first - outcomes link to a lead record.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Lead">
                <Select name="leadId" options={leadOptions} defaultValue={d(seed?.leadId, editing?.leadId ?? leadOptions[0].value)} />
              </Field>
              <Field label="Call date">
                <TextInput type="date" name="callDate" required defaultValue={d(seed?.callDate, editing ? editing.callDate.slice(0, 10) : today)} />
              </Field>
              <Field label="Call outcome">
                <Select name="outcome" options={optionsFrom(CALL_OUTCOME_LABELS)} defaultValue={d(seed?.outcome, editing?.outcome ?? "QUALIFIED_FOR_SSS")} />
              </Field>
              <Field label="SSS date (if booked)">
                <TextInput type="date" name="sssDate" defaultValue={d(seed?.sssDate, editing?.sssDate?.slice(0, 10) ?? "")} />
              </Field>
              <div className="flex items-end pb-1">
                <CheckboxField name="highlyQualified" label="Highly qualified" defaultChecked={d(seed?.highlyQualified, editing?.highlyQualified ?? false)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="mb-1.5 text-sm font-medium">BANT qualification <span className="font-normal text-muted">- drives the “call these first” ranking</span></p>
                <div className="flex flex-wrap gap-4">
                  <CheckboxField name="bantBudget" label="Budget" defaultChecked={d(seed?.bantBudget, editing?.bantBudget ?? false)} />
                  <CheckboxField name="bantAuthority" label="Authority" defaultChecked={d(seed?.bantAuthority, editing?.bantAuthority ?? false)} />
                  <CheckboxField name="bantNeed" label="Need" defaultChecked={d(seed?.bantNeed, editing?.bantNeed ?? false)} />
                  <CheckboxField name="bantTimeline" label="Timeline" defaultChecked={d(seed?.bantTimeline, editing?.bantTimeline ?? false)} />
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Call notes" hint="Summary of what was discussed - key notes to closer">
                  <TextArea kind="text" name="notes" defaultValue={d(seed?.notes, editing?.notes ?? "")} />
                </Field>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Btn size="sm" icon={<Sparkles size={14} />} onClick={extract} busy={extracting}>
                    Fill from note
                  </Btn>
                  <span className="text-caption text-ink-3">
                    Reads the note and ticks what it finds. Check it before saving.
                  </span>
                </div>
              </div>
            </div>

            {suggestion && <SuggestionPanel result={suggestion} />}

            <div className="mt-4 flex items-center gap-3">
              <SubmitButton>{editing ? "Save changes" : "Add outcome"}</SubmitButton>
              <FormError message={error} />
            </div>
          </>
        )}
        </form>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        csvName={isAdmin ? "discovery-outcomes" : undefined}
        filterPlaceholder="Filter outcomes…"
      />
    </section>
  );
}

/**
 * What the extractor did, and why. Every tick is shown with the phrase it came from - a
 * suggestion you can't check is one you have to either trust blindly or redo by hand, and
 * these fields feed commission.
 */
function SuggestionPanel({
  result,
}: {
  result: { extraction: CallNoteExtraction; fallbackReason: string | null };
}) {
  const x = result.extraction;
  const ticks = (Object.keys(x.bant) as (keyof BantFlags)[]).filter((k) => x.bant[k]);
  const weak = x.confidence < LOW_CONFIDENCE;
  // The AI is asked to quote the note verbatim, so its evidence gets quote marks. The rules
  // pass reports which RULE fired ("affordability mentioned") - quoting that would imply the
  // specialist wrote those words, which is exactly the kind of small lie this panel exists
  // to avoid.
  const cite = (phrase: string) => (x.source === "ai" ? `“${phrase}”` : phrase);

  return (
    <div className="mt-4 rounded-field border border-line bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-label font-semibold uppercase text-ink-3">From the note</span>
        <Pill tone={x.source === "ai" ? "primary" : "neutral"}>{x.source === "ai" ? "AI" : "Rules"}</Pill>
        {weak && <Pill tone="warn">Low confidence - read it yourself</Pill>}
      </div>

      <p className="text-sm text-ink">{summariseExtraction(x)}</p>

      {(ticks.length > 0 || x.evidence.outcome || x.evidence.followUpDate) && (
        <ul className="mt-2 space-y-1 text-caption text-ink-2">
          {x.evidence.outcome && (
            <li>
              · Outcome - <span className="italic">{cite(x.evidence.outcome)}</span>
            </li>
          )}
          {ticks.map((k) => (
            <li key={k}>
              · {BANT_LABELS[k]} - <span className="italic">{cite(x.evidence[k] ?? "-")}</span>
            </li>
          ))}
          {x.evidence.followUpDate && (
            <li>
              · Follow-up {x.followUpDate} - <span className="italic">{cite(x.evidence.followUpDate)}</span>
              {x.outcome !== "QUALIFIED_FOR_SSS" && " (not filled in - that's the SSS date field)"}
            </li>
          )}
        </ul>
      )}

      {x.objection && (
        <p className="mt-2 text-caption text-ink-2">
          Main blocker: <span className="font-semibold text-ink">{x.objection}</span>
        </p>
      )}
      {x.summary && <p className="mt-1 text-caption text-ink-2">For the closer: {x.summary}</p>}
      {x.highlyQualified && (
        // Read-only on purpose: highlyQualified is capability-guarded and drives commission.
        <p className="mt-1 text-caption text-ink-2">
          Reads as <span className="font-semibold text-ink">highly qualified</span> - tick it yourself if you agree.
        </p>
      )}
      {result.fallbackReason && <p className="mt-2 text-caption text-ink-3">{result.fallbackReason}</p>}
    </div>
  );
}
