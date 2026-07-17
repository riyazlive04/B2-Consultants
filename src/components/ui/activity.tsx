"use client";

/**
 * The Daily Log activity feed.
 *
 * A `LogEntry` (derived server-side in people-metrics) is rendered as a card that answers
 * six questions at a glance — what happened, when, who, why it matters, its status, and the
 * next action — instead of a row of bare numbers. `ActivityTimeline` groups those cards into
 * relative-date buckets and layers search, status filters, sort and lazy pagination on top.
 *
 * Presentational only: all grading/labelling is already baked into the entry. This file just
 * decides how it looks, so the same component serves both the personal log and the admin board.
 */

import { useMemo, useState } from "react";
import {
  Phone, Star, Reply, Send, UserX, CalendarCheck, UserPlus, GraduationCap,
  UserCheck, ClipboardCheck, AlertTriangle, Hash, MessageSquare,
  Sparkles, Check, TrendingDown, Moon, Circle, Wand2, PencilLine,
  Search, ChevronDown, Inbox, ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LogEntry, LogMetric, LogStatusKey, StatusTone } from "@/lib/daily-log";
import { Avatar, EmptyState, Pill, type Tone } from "./kit";

// ── icon maps ──────────────────────────────────────────────────

const METRIC_ICON: Record<string, LucideIcon> = {
  discoveryCallsCompleted: Phone,
  highlyQualifiedCalls: Star,
  followUpsDone: Reply,
  proposalsSent: Send,
  noShows: UserX,
  newLeadsContacted: Phone,
  appointmentsSet: CalendarCheck,
  followUpMessagesSent: MessageSquare,
  leadsAddedToPipeline: UserPlus,
  sessionsDelivered: GraduationCap,
  studentsCheckedInOn: UserCheck,
  assignmentsReviewed: ClipboardCheck,
  studentsFlaggedAtRisk: AlertTriangle,
};

const STATUS_ICON: Record<LogStatusKey, LucideIcon> = {
  standout: Sparkles,
  ontarget: Check,
  belowpar: TrendingDown,
  quiet: Moon,
  logged: Circle,
};

// StatusTone lines up 1:1 with the kit Pill's Tone, so the pill re-themes for free.
const toneToPill = (t: StatusTone): Tone => t;

// ── metric chip ────────────────────────────────────────────────

export function MetricChip({ metric }: { metric: LogMetric }) {
  const Icon = METRIC_ICON[metric.key] ?? Hash;
  const valueClass =
    metric.emphasis === "up" ? "text-good" : metric.emphasis === "down" ? "text-bad" : "text-ink";
  return (
    <span className="inline-flex items-center gap-2 rounded-field border border-line bg-surface-2 px-2.5 py-1.5 text-caption">
      <Icon size={14} className="flex-none text-muted" />
      <span className={`tnum font-bold ${valueClass}`}>{metric.value}</span>
      <span className="text-muted">{metric.unit}</span>
      {metric.auto && (
        <span
          title="Auto-captured from your activity"
          aria-label="Auto-captured"
          className="ml-0.5 h-1.5 w-1.5 flex-none rounded-full bg-primary"
        />
      )}
    </span>
  );
}

// ── one entry ──────────────────────────────────────────────────

/** The left accent stripe encodes the thing that most needs the eye. */
function accentClass(entry: LogEntry): string {
  if (entry.correctionNote) return "border-l-[3px] border-l-primary";
  if (entry.status.key === "standout") return "border-l-[3px] border-l-good";
  if (entry.status.tone === "bad") return "border-l-[3px] border-l-bad";
  if (entry.status.tone === "warn" || entry.hasBlockers) return "border-l-[3px] border-l-warn";
  return "";
}

/** A short, honest "what to do next" derived from the entry's state. */
function nextAction(entry: LogEntry): string {
  if (entry.correctionNote) return "Reviewed & reconciled — nothing needed";
  if (entry.status.key === "quiet") return "Check what blocked the day and plan tomorrow";
  if (entry.hasBlockers) return "Follow up on the blocker you logged";
  if (entry.status.key === "belowpar") return "Line up more for tomorrow to get back on pace";
  if (entry.status.key === "standout") return "Keep the momentum going";
  return "No action needed";
}

export function LogEntryCard({
  entry,
  mode = "personal",
  onCorrect,
}: {
  entry: LogEntry;
  mode?: "personal" | "team";
  onCorrect?: (entry: LogEntry) => void;
}) {
  const StatusIcon = STATUS_ICON[entry.status.key];
  const whenLabel =
    entry.relDays === 0 ? "Today" : entry.relDays === 1 ? "Yesterday" : entry.dateLabel;

  return (
    <div className={`rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong sm:p-5 ${accentClass(entry)}`}>
      {/* who / when · status badges */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "team" && entry.person && <Avatar name={entry.person.name} size={36} />}
          <div className="min-w-0">
            {mode === "team" && entry.person ? (
              <>
                <p className="truncate text-body-strong text-ink">{entry.person.name}</p>
                <p className="truncate text-caption text-muted">
                  {entry.person.role} · {whenLabel}
                  {entry.submittedTimeLabel ? ` · ${entry.submittedTimeLabel}` : ""}
                </p>
              </>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-2 text-body-strong text-ink">
                {whenLabel}
                {entry.submittedTimeLabel && (
                  <span className="text-caption font-normal text-muted">
                    submitted {entry.submittedTimeLabel}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={toneToPill(entry.status.tone)}>
            <StatusIcon size={12} /> {entry.status.label}
          </Pill>
          {entry.autoKeys.length > 0 && (
            <Pill tone="info" title={`${entry.autoKeys.length} field(s) auto-captured from real activity`}>
              <Wand2 size={12} /> Auto-captured
            </Pill>
          )}
          {entry.correctionNote && (
            <Pill tone="primary">
              <PencilLine size={12} /> Correction
            </Pill>
          )}
          {entry.hasBlockers && !entry.correctionNote && (
            <Pill tone="warn">
              <AlertTriangle size={12} /> Blocker
            </Pill>
          )}
        </div>
      </div>

      {/* what happened */}
      <p className="mt-3 text-body text-ink-2">{entry.narrative}</p>

      {/* the numbers, as scannable chips */}
      {entry.metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.metrics.map((m) => (
            <MetricChip key={m.key} metric={m} />
          ))}
        </div>
      )}

      {/* why it matters */}
      <p className="mt-3 flex items-start gap-1.5 text-caption text-muted">
        <StatusIcon size={13} className="mt-px flex-none" />
        {entry.status.context}
      </p>

      {/* notes / blockers */}
      {entry.notes && (
        <div className="mt-3 rounded-r-field border-l-[3px] border-line-strong bg-surface-2 px-3 py-2">
          <p className="text-label font-semibold uppercase text-ink-3">Notes / blockers</p>
          <p className="mt-0.5 text-caption text-ink-2">{entry.notes}</p>
        </div>
      )}

      {/* admin correction — original stays intact */}
      {entry.correctionNote && (
        <div className="mt-3 rounded-r-field border-l-[3px] border-primary bg-primary-soft px-3 py-2">
          <p className="text-label font-semibold uppercase text-primary-strong">Admin correction</p>
          <p className="mt-0.5 text-caption text-ink-2">{entry.correctionNote}</p>
        </div>
      )}

      {/* next action + quick actions */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-line pt-3">
        <p className="flex items-center gap-1.5 text-caption text-ink-2">
          <span className="font-semibold text-ink-3">Next</span>
          <ArrowRight size={13} className="text-primary" />
          {nextAction(entry)}
        </p>
        {mode === "team" && onCorrect && !entry.correctionNote && (
          <button
            type="button"
            onClick={() => onCorrect(entry)}
            className="inline-flex h-8 items-center gap-1.5 rounded-field border border-line bg-surface px-2.5 text-caption font-semibold text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <PencilLine size={13} /> Add correction
          </button>
        )}
      </div>
    </div>
  );
}

// ── filter bar ─────────────────────────────────────────────────

type FilterKey = "all" | "standout" | "belowpar" | "blockers" | "corrected";

const FILTERS: { key: FilterKey; label: string; match: (e: LogEntry) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "standout", label: "Standout", match: (e) => e.status.key === "standout" },
  { key: "belowpar", label: "Below par", match: (e) => e.status.key === "belowpar" || e.status.key === "quiet" },
  { key: "blockers", label: "With blockers", match: (e) => e.hasBlockers },
  { key: "corrected", label: "Corrected", match: (e) => !!e.correctionNote },
];

// ── the timeline ───────────────────────────────────────────────

export function ActivityTimeline({
  entries,
  mode = "personal",
  onCorrect,
  pageSize = 8,
  emptyTitle = "No entries yet",
  emptyBody,
}: {
  entries: LogEntry[];
  mode?: "personal" | "team";
  onCorrect?: (entry: LogEntry) => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [visible, setVisible] = useState(pageSize);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, standout: 0, belowpar: 0, blockers: 0, corrected: 0 };
    for (const e of entries) for (const f of FILTERS) if (f.match(e)) c[f.key]++;
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchFn = FILTERS.find((f) => f.key === filter)!.match;
    let out = entries.filter((e) => matchFn(e) && (!q || e.searchText.includes(q)));
    if (sort === "old") out = [...out].reverse();
    return out;
  }, [entries, query, filter, sort]);

  const shown = filtered.slice(0, visible);

  // Group consecutive entries into their date buckets (order already correct after sort).
  const groups = useMemo(() => {
    const g: { key: string; label: string; items: LogEntry[] }[] = [];
    for (const e of shown) {
      const last = g[g.length - 1];
      if (last && last.key === e.bucketKey) last.items.push(e);
      else g.push({ key: e.bucketKey, label: e.bucketLabel, items: [e] });
    }
    return g;
  }, [shown]);

  if (entries.length === 0) {
    return <EmptyState icon={<Inbox size={22} />} title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={15} />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisible(pageSize); }}
            placeholder="Search entries…"
            aria-label="Search log entries"
            className="h-10 w-full rounded-field border border-line bg-surface pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => { setFilter(f.key); setVisible(pageSize); }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-caption font-semibold transition-colors ${
                filter === f.key
                  ? "border-primary bg-primary text-on-accent"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong"
              }`}
            >
              {f.label}
              <span className={`tnum ${filter === f.key ? "opacity-80" : "text-ink-3"}`}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "new" | "old")}
          aria-label="Sort entries"
          className="ml-auto h-10 rounded-field border border-line bg-surface px-2.5 text-sm text-ink-2 outline-none focus:border-primary"
        >
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
      </div>

      {/* results */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title="No entries match"
          body="Try a different filter or clear your search to see the full history."
        />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} className="space-y-3">
              <h3 className="flex items-center gap-3 text-label font-semibold uppercase tracking-wide text-muted">
                {group.label}
                <span className="h-px flex-1 bg-line" />
              </h3>
              {mode === "personal" ? (
                <ol className="relative space-y-3 pl-6">
                  <span aria-hidden className="absolute bottom-1 left-[7px] top-2 w-0.5 bg-line" />
                  {group.items.map((e) => (
                    <li key={e.id} className="relative">
                      <span
                        aria-hidden
                        className={`absolute -left-[22px] top-5 h-3 w-3 rounded-full border-2 bg-surface ring-4 ring-canvas ${dotClass(e)}`}
                      />
                      <LogEntryCard entry={e} mode={mode} onCorrect={onCorrect} />
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="space-y-3">
                  {group.items.map((e) => (
                    <LogEntryCard key={e.id} entry={e} mode={mode} onCorrect={onCorrect} />
                  ))}
                </div>
              )}
            </section>
          ))}

          {visible < filtered.length && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setVisible((v) => v + pageSize)}
                className="inline-flex h-10 items-center gap-2 rounded-btn border border-line bg-surface px-4 text-sm font-semibold text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <ChevronDown size={15} />
                Load {Math.min(pageSize, filtered.length - visible)} more
                <span className="tnum text-muted">({filtered.length - visible} left)</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Timeline dot colour, matching the card's accent. */
function dotClass(entry: LogEntry): string {
  if (entry.correctionNote) return "border-primary";
  if (entry.status.key === "standout") return "border-good";
  if (entry.status.tone === "bad") return "border-bad";
  if (entry.status.tone === "warn" || entry.hasBlockers) return "border-warn";
  return "border-line-strong";
}
