"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { DatePicker } from "@/components/ui/DatePicker";
import type { ActivityFilterOptions } from "@/server/activity-metrics";

/**
 * The filter bar. A plain GET <form> — every control writes a search param, so the result is
 * a URL the founder can bookmark or send to someone ("here's exactly what I'm looking at").
 * No client state holds the filters; the server already has them.
 *
 * `view` rides along as a hidden field so submitting a filter doesn't bounce you from the
 * table back to the feed, and `page` is deliberately NOT carried: changing a filter must
 * reset to page 1, or you land on page 7 of a 2-page result and see nothing.
 */
export function ActivityFilters({
  options,
  current,
  view,
  active,
}: {
  options: ActivityFilterOptions;
  current: { actor?: string; section?: string; action?: string; from?: string; to?: string; q?: string };
  view: "feed" | "table";
  active: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} method="GET" action="/activity" className="space-y-3">
      <input type="hidden" name="view" value={view} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <label htmlFor="activity-q" className="mb-1 block text-label font-semibold uppercase text-ink-3">
            Search
          </label>
          <Search className="pointer-events-none absolute left-3 top-[34px] text-muted" size={15} />
          <input
            id="activity-q"
            name="q"
            defaultValue={current.q ?? ""}
            placeholder="Name, record, anything…"
            className="h-10 w-full rounded-field border border-line bg-surface pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>

        <Field label="Who" htmlFor="activity-actor">
          <SelectMenu
            id="activity-actor"
            name="actor"
            defaultValue={current.actor ?? ""}
            onChange={submit}
            placeholder="Everyone"
            options={[{ value: "", label: "Everyone" }, ...options.actors]}
          />
        </Field>

        <Field label="Section" htmlFor="activity-section">
          <SelectMenu
            id="activity-section"
            name="section"
            defaultValue={current.section ?? ""}
            onChange={submit}
            placeholder="All sections"
            options={[{ value: "", label: "All sections" }, ...options.sections]}
          />
        </Field>

        <Field label="Action" htmlFor="activity-action">
          <SelectMenu
            id="activity-action"
            name="action"
            defaultValue={current.action ?? ""}
            onChange={submit}
            placeholder="All actions"
            options={[{ value: "", label: "All actions" }, ...options.actions]}
          />
        </Field>

        <Field label="From" htmlFor="activity-from">
          <DatePicker id="activity-from" name="from" defaultValue={current.from ?? ""} onChange={submit} />
        </Field>

        <Field label="To" htmlFor="activity-to">
          <DatePicker id="activity-to" name="to" defaultValue={current.to ?? ""} onChange={submit} />
        </Field>

        <button
          type="submit"
          className="h-10 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
        >
          Apply
        </button>

        {active && (
          <Link
            href={`/activity?view=${view}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <X size={14} /> Clear
          </Link>
        )}
      </div>
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
