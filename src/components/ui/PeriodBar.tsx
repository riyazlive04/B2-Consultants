"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import {
  periodIsCurrent,
  periodQuery,
  resolvePeriod,
  shiftPeriod,
  type PeriodKind,
  type PeriodSpec,
} from "@/lib/period";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Modal";
import { Btn } from "./controls";

/**
 * The one period control. Week / month / quarter / year / custom, plus ‹ › and a "now" reset.
 *
 * Writes `?period=` (and `?on=` / `?from=&to=`) and lets the SERVER re-render. Deliberately not
 * client-side filtering: these screens read money and 23k leads out of Postgres, and the whole
 * point of the control is that the QUERY changes — a client filter over an already-capped page
 * would show "July" as whatever subset of July happened to be in the first 300 rows.
 *
 * Every OTHER query param is preserved on navigation, so a period change never silently drops
 * the owner/stage/source filters someone has already set.
 */

const KIND_LABELS: { key: PeriodKind; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  { key: "all", label: "All" },
];

export function PeriodBar({
  spec,
  /** Hide kinds that make no sense for a screen (e.g. "all" on a cash-runway view). */
  kinds = ["week", "month", "quarter", "year", "all"],
  /**
   * Which query params this control writes.
   *
   *   "period"  →  `?period=month&on=…`  — the default, for pages whose whole query is scoped
   *                by the window.
   *   "dates"   →  `?from=YYYY-MM-DD&to=YYYY-MM-DD` — for pages that ALREADY have a from/to date
   *                filter (Contacts). Writing `?period=` there would create a second, competing
   *                date mechanism on one screen, where the two could disagree and the user could
   *                not tell which had won. This makes the bar a set of shortcuts INTO the filter
   *                the page already has.
   *
   * `to` is written INCLUSIVE, matching what a human picks in a date field and what the existing
   * filters expect.
   */
  writes = "period",
  className,
}: {
  spec: PeriodSpec;
  kinds?: PeriodKind[];
  writes?: "period" | "dates";
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(false);

  const resolved = resolvePeriod(spec);
  const atNow = periodIsCurrent(resolved);
  const shown = KIND_LABELS.filter((k) => kinds.includes(k.key));

  const go = (next: PeriodSpec) => {
    // Merge, don't replace. `?owner=` and `?stage=` belong to the page's own filter bar and
    // must survive a period change — losing them silently is how a filtered view lies.
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["period", "on", "from", "to", "range"]) params.delete(key);

    if (writes === "dates") {
      if (next.kind !== "all") {
        const r = resolvePeriod(next);
        const lastDay = new Date(r.endExclusive.getTime() - 86_400_000);
        params.set("from", r.start.toISOString().slice(0, 10));
        params.set("to", lastDay.toISOString().slice(0, 10));
      }
      // "all" clears both, which is exactly what an empty date filter already means here.
    } else {
      for (const [k, v] of new URLSearchParams(periodQuery(next))) params.set(k, v);
    }

    // Any window change starts back at page 1 — a cursor from the previous window points into
    // rows the new `where` clause may not contain at all.
    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
        {shown.map((k) => (
          <button
            key={k.key}
            type="button"
            aria-pressed={spec.kind === k.key}
            onClick={() => go({ kind: k.key, anchor: spec.anchor })}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              spec.kind === k.key ? "bg-ink text-surface" : "text-muted hover:text-ink"
            }`}
          >
            {k.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={spec.kind === "custom"}
          onClick={() => setCustomOpen(true)}
          title="Pick an exact date range"
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            spec.kind === "custom" ? "bg-ink text-surface" : "text-muted hover:text-ink"
          }`}
        >
          <CalendarRange size={13} /> Custom
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(shiftPeriod(spec, -1))}
          disabled={spec.kind === "all"}
          aria-label="Previous period"
          className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="tnum min-w-36 text-center text-sm font-semibold text-ink">{resolved.label}</span>
        <button
          type="button"
          onClick={() => go(shiftPeriod(spec, 1))}
          disabled={spec.kind === "all"}
          aria-label="Next period"
          className="grid h-8 w-8 place-items-center rounded-field border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
        {/* Only offered when it would DO something — a live "Today" that is already today is a
            control that teaches people the page ignores them. */}
        {!atNow && spec.kind !== "all" && (
          <button
            type="button"
            onClick={() => go({ kind: spec.kind, anchor: "" })}
            className="rounded-field border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Now
          </button>
        )}
      </div>

      {customOpen && (
        <Modal open onClose={() => setCustomOpen(false)} title="Pick a date range" size="sm">
          <form
            action={(form) => {
              const from = String(form.get("from") ?? "");
              const to = String(form.get("to") ?? "");
              if (!from || !to) return;
              setCustomOpen(false);
              go({ kind: "custom", anchor: from, from, to });
            }}
            className="space-y-4"
          >
            <label className="block text-xs font-semibold text-ink-2">
              From
              <div className="mt-1.5">
                <DatePicker name="from" required defaultValue={spec.from ?? ""} />
              </div>
            </label>
            <label className="block text-xs font-semibold text-ink-2">
              To
              <div className="mt-1.5">
                {/* Inclusive — `resolvePeriod` adds the extra day, so a range ending today
                    includes today. */}
                <DatePicker name="to" required defaultValue={spec.to ?? ""} />
              </div>
            </label>
            <div className="flex justify-end gap-2">
              <Btn type="button" variant="ghost" onClick={() => setCustomOpen(false)}>Cancel</Btn>
              <Btn type="submit">Apply</Btn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
