"use client";

import Link from "next/link";
import { useRef } from "react";
import { X } from "lucide-react";
import { SelectMenu } from "@/components/ui/SelectMenu";
import {
  IMPROVEMENT_KIND_DEFS,
  IMPROVEMENT_SEVERITY_DEFS,
  IMPROVEMENT_SEVERITY_SHORT,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STATUS_LABELS,
} from "@/lib/improvement";

/**
 * The queue's filter bar. A plain GET form, like the activity log's: every control writes a
 * search param, so any view of this screen is a URL somebody can send ("these four, this week").
 *
 * `page` is deliberately not carried - changing a filter must reset to page 1, or you land on
 * page 3 of a one-page result and conclude the queue is empty.
 */
export function ImprovementFilters({
  current,
  sections,
  reporters,
  active,
}: {
  current: { status: string; kind: string | null; severity: string | null; section: string | null; reporter: string | null };
  sections: { value: string; label: string }[];
  reporters: { value: string; label: string }[];
  active: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} method="GET" action="/improvements" className="flex flex-wrap items-end gap-2">
      <Field label="Status" htmlFor="improvement-status">
        <SelectMenu
          id="improvement-status"
          name="status"
          defaultValue={current.status}
          onChange={submit}
          options={[
            // "Open" first and default: the question somebody opens this screen to answer is
            // "what is waiting for me", not "what has ever been reported".
            { value: "OPEN", label: "Open" },
            { value: "ALL", label: "Everything" },
            ...IMPROVEMENT_STATUSES.map((s) => ({ value: s, label: IMPROVEMENT_STATUS_LABELS[s] })),
          ]}
        />
      </Field>

      <Field label="Kind" htmlFor="improvement-kind">
        <SelectMenu
          id="improvement-kind"
          name="kind"
          defaultValue={current.kind ?? ""}
          onChange={submit}
          placeholder="Any kind"
          options={[
            { value: "", label: "Any kind" },
            ...IMPROVEMENT_KIND_DEFS.map((k) => ({ value: k.key, label: k.label })),
          ]}
        />
      </Field>

      <Field label="Hurt" htmlFor="improvement-severity">
        <SelectMenu
          id="improvement-severity"
          name="severity"
          defaultValue={current.severity ?? ""}
          onChange={submit}
          placeholder="Any"
          options={[
            { value: "", label: "Any" },
            ...IMPROVEMENT_SEVERITY_DEFS.map((s) => ({ value: s.key, label: IMPROVEMENT_SEVERITY_SHORT[s.key] })),
          ]}
        />
      </Field>

      <Field label="Screen" htmlFor="improvement-section">
        <SelectMenu
          id="improvement-section"
          name="section"
          defaultValue={current.section ?? ""}
          onChange={submit}
          placeholder="Every screen"
          options={[{ value: "", label: "Every screen" }, ...sections]}
        />
      </Field>

      <Field label="Who" htmlFor="improvementer">
        <SelectMenu
          id="improvementer"
          name="reporter"
          defaultValue={current.reporter ?? ""}
          onChange={submit}
          placeholder="Anyone"
          options={[{ value: "", label: "Anyone" }, ...reporters]}
        />
      </Field>

      <button
        type="submit"
        className="h-10 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        Apply
      </button>

      {active && (
        <Link
          href="/improvements"
          className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <X size={14} /> Clear
        </Link>
      )}
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="min-w-36">
      <label htmlFor={htmlFor} className="mb-1 block text-label font-semibold uppercase text-ink-3">
        {label}
      </label>
      {children}
    </div>
  );
}
