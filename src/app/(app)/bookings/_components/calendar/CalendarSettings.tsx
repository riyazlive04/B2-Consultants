"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { SegmentedControl } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/kit";
import { SETTING_STATUS_LABELS, type CalendarSetting, type SettingStatus } from "@/lib/calendar-settings";

/**
 * Synamate's Calendar settings list - as a door onto the screens B2 already has, not a second
 * place to configure anything. Every row's ✎ goes to the one screen that owns that setting.
 *
 * The column Synamate does not have is the one worth coming here for: whether this calendar is
 * actually offering anybody a time, and if not, why not.
 */

const GROUPS = [
  { value: "all" as const, label: "All calendars" },
  { value: "DISCO" as const, label: "Discovery" },
  { value: "SSS" as const, label: "Strategy" },
];

/** Switched-off and no-days are states somebody chose or forgot; both read as a warning. */
const TONE: Record<SettingStatus, string> = {
  ACTIVE: "border-good bg-good-soft text-good-ink",
  NO_AVAILABILITY: "border-warn bg-warn-soft text-warn-ink",
  SWITCHED_OFF: "border-line bg-surface-2 text-ink-2",
  NO_DAYS: "border-warn bg-warn-soft text-warn-ink",
  NO_OWNER: "border-warn bg-warn-soft text-warn-ink",
};

export function CalendarSettings({ rows, canConfigure }: { rows: CalendarSetting[]; canConfigure: boolean }) {
  const [group, setGroup] = useState<"all" | "DISCO" | "SSS">("all");
  const shown = rows.filter((r) => group === "all" || r.group === group);
  const count = (g: "DISCO" | "SSS") => rows.filter((r) => r.group === g).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={group}
          onChange={setGroup}
          ariaLabel="Calendar group"
          options={GROUPS.map((g) => ({
            ...g,
            label: g.value === "all" ? `${g.label} (${rows.length})` : `${g.label} (${count(g.value)})`,
          }))}
        />
        {/* Calendars are created where they are configured. This is a door, not a second form. */}
        {canConfigure && (
          <Link
            href="/console?area=sales&panel=availability"
            className="inline-flex h-9 items-center gap-1.5 rounded-btn bg-accent px-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
          >
            <Plus size={15} aria-hidden /> New calendar
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="No calendars yet"
          body="A discovery calendar is a named weekly pattern in Console → Availability. Until one exists, no slots are generated and /book shows prospects an empty calendar."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((r) => (
            <li key={r.key} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: r.color }}
                    />
                    <span className="truncate font-semibold text-ink">{r.name}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-caption text-muted">
                    {r.ownerName} · {r.durationMins ? `${r.durationMins} min` : "mixed lengths"}
                  </span>
                </span>
                <span className={`flex-none rounded-full border px-2 py-0.5 text-caption font-semibold ${TONE[r.status]}`}>
                  {SETTING_STATUS_LABELS[r.status]}
                </span>
              </div>

              <dl className="mt-3 space-y-1 text-caption">
                <div className="flex gap-2">
                  <dt className="text-muted">When</dt>
                  <dd className="min-w-0 flex-1 truncate text-ink-2">{r.schedule}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted">Open ahead</dt>
                  <dd className="flex-1 text-ink-2 tnum">{r.openAhead}</dd>
                </div>
              </dl>
              <p className="mt-2 text-caption text-muted">{r.detail}</p>

              <Link
                href={r.editHref}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                {r.group === "SSS" ? "Open the SSS calendar" : "Open its settings"}
                <ExternalLink size={13} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
