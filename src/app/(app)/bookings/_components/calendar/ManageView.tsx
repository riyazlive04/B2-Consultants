"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/controls";
import { calendarRef, ownerColor, type CalType } from "@/lib/calendar-event";
import {
  DEFAULT_FILTERS, filterParams, isDefaultFilters, toggleCal, toggleUser, userShown,
  type CalFilters, type ViewType,
} from "@/lib/calendar-filters";

/**
 * Synamate's "Manage view" panel: whose calendars, which calendars, and whether blocked time is
 * drawn. Every choice is a URL parameter, so the grid is re-rendered on the server and a shared
 * link opens the same view.
 *
 * Synamate has three lists - Users, Calendars and Groups. B2 has only two things to pick from,
 * because a calendar here IS (person × call type): the groups ARE the calendars. Two lists, not
 * three that can contradict each other.
 */

/**
 * Discovery carries no dot on purpose: a discovery calendar takes its OWNER's colour, so there
 * is no one colour to show. Strategy sessions do share one, so that one is shown.
 */
const CALS: { value: CalType; label: string; color?: string }[] = [
  { value: "DISCO", label: "Discovery calls" },
  { value: "SSS", label: "Strategy sessions", color: calendarRef("SSS", null, 0).color },
];
const VIEW_OPTIONS: { value: ViewType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "appointments", label: "Calls" },
  { value: "blocked", label: "Blocked" },
];
/** Synamate shows five people before "See more"; longer teams stay one scan rather than a list. */
const SHOWN = 5;

export function ManageView({
  filters, team, closeHref,
}: {
  filters: CalFilters;
  team: { id: string; name: string | null }[];
  /** Where the X goes: the same page without `?panel`. */
  closeHref: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);

  const allUserIds = [...team.map((u) => u.id), ""];
  const apply = (next: CalFilters) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(filterParams(next))) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`/bookings?${p}`);
  };

  const people = [
    ...team.map((u, i) => ({ id: u.id, name: u.name ?? "Unnamed", color: ownerColor(i) })),
    { id: "", name: "Unassigned", color: ownerColor(-1) },
  ];
  const matches = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const visible = showAll || q ? matches : matches.slice(0, SHOWN);
  const hidden = matches.length - visible.length;
  const calOn = (c: CalType) => filters.cals === null || filters.cals.includes(c);
  const isDefault = isDefaultFilters(filters);

  /**
   * Beside the grid, not over it: as an overlay this panel covered Saturday and Sunday, and the
   * whole point of ticking a name is watching the grid change. The grid gives up the width.
   */
  return (
    <aside
      aria-label="Manage view"
      className="w-full shrink-0 space-y-4 self-start rounded-card border border-line bg-surface p-4 shadow-card lg:w-[300px]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold">Manage view</h3>
        <Link
          href={closeHref}
          aria-label="Close manage view"
          className="grid h-7 w-7 place-items-center rounded-field text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} />
        </Link>
      </div>

      <div className="space-y-1.5">
        <p className="text-label uppercase text-ink-2">View by type</p>
        <SegmentedControl
          size="sm"
          grow
          ariaLabel="View by type"
          value={filters.type}
          options={VIEW_OPTIONS}
          onChange={(type) => apply({ ...filters, type })}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-label uppercase text-ink-2">Filters</p>
        {!isDefault && (
          <button type="button" onClick={() => apply(DEFAULT_FILTERS)} className="text-xs font-semibold text-accent hover:underline">
            Clear all
          </button>
        )}
      </div>

      <label className="flex h-9 items-center gap-2 rounded-field border border-line px-2.5">
        <Search size={14} className="flex-none text-ink-3" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team members"
          aria-label="Search team members"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
        />
      </label>

      <section className="space-y-0.5">
        <p className="text-label uppercase text-ink-2">Team ({people.length})</p>
        {visible.map((p) => (
          <Row
            key={p.id || "unassigned"}
            label={p.name}
            color={p.color}
            checked={userShown(filters, p.id)}
            onChange={() => apply(toggleUser(filters, p.id, allUserIds))}
          />
        ))}
        {matches.length === 0 && <p className="py-2 text-sm text-muted">No matches</p>}
        {hidden > 0 && (
          <button type="button" onClick={() => setShowAll(true)} className="pt-1 text-xs font-semibold text-accent hover:underline">
            See more (+{hidden})
          </button>
        )}
      </section>

      <section className="space-y-0.5">
        <p className="text-label uppercase text-ink-2">Calendars</p>
        {CALS.map((c) => (
          <Row
            key={c.value}
            label={c.label}
            color={c.color}
            checked={calOn(c.value)}
            onChange={() => apply(toggleCal(filters, c.value))}
          />
        ))}
      </section>
    </aside>
  );
}

/** One ticked line: a colour dot, a name, and the whole row as the hit target (§7). */
function Row({ label, color, checked, onChange }: { label: string; color?: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-field px-1 text-sm hover:bg-surface-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 flex-none accent-[var(--primary)]" />
      {color && <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: color }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
}
