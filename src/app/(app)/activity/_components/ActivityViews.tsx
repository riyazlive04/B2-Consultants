import { Cog } from "lucide-react";
import { Avatar, EmptyState, Pill, TableShell, Td, Th, Tr, type Tone } from "@/components/ui/kit";
import { activityDayKey, activityDate, activityRelative, activityStamp, activityTime } from "@/lib/activity-actions";
import type { ActivityKind } from "@/lib/activity-actions";
import type { ActivityRow } from "@/server/activity-metrics";

/**
 * The two ways to read the log.
 *
 * FEED answers "what's been happening" — chronological, grouped by IST day, easy to skim.
 * TABLE answers "what exactly did Asma do at 3pm" — one dense row per action, timestamp to
 * the second, nothing wrapped or summarised away.
 *
 * Both are server components: the log can be tens of thousands of rows and none of it needs
 * to reach the browser. The meta drill-down is a native <details>, so it costs no JS.
 */

const KIND_TONE: Record<ActivityKind, Tone> = {
  create: "good",
  update: "info",
  delete: "bad",
  send: "primary",
  auth: "warn",
  other: "neutral",
};

/**
 * Roles are stamped at write time, so a departed or re-roled user still reads correctly.
 *
 * SYSTEM is called "Automation" rather than left as-is: the founder must be able to tell at a
 * glance that the engine sent those forty reminders overnight and no person did.
 */
function roleLabel(role: string): string {
  if (role === "ADMIN") return "Founder";
  if (role === "SYSTEM") return "Automation";
  if (role === "PUBLIC") return "Public";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Who acted. An engine gets a cog, not initials: `Avatar` would render "Reminder engine" as
 * "RE" in the same circle a person gets, which reads as somebody's initials at a glance —
 * the one thing this row must never imply.
 */
function ActorMark({ name, role }: { name: string; role: string }) {
  if (role !== "SYSTEM") return <Avatar name={name} size={30} />;
  return (
    <span
      aria-hidden
      className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full border border-line bg-surface-2 text-muted"
    >
      <Cog size={15} />
    </span>
  );
}

function MetaDetails({ meta }: { meta: unknown }) {
  if (!meta || typeof meta !== "object" || Object.keys(meta as object).length === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer select-none text-caption text-muted transition-colors hover:text-ink-2">
        Details
      </summary>
      <pre className="mt-1.5 overflow-x-auto rounded-field border border-line bg-surface-2 p-2.5 text-xs leading-relaxed text-ink-2">
        {JSON.stringify(meta, null, 2)}
      </pre>
    </details>
  );
}

// ── feed ───────────────────────────────────────────────────────

export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) return <NoResults />;

  // Rows arrive newest-first, so consecutive grouping preserves the order.
  const groups: { key: string; label: string; items: ActivityRow[] }[] = [];
  for (const r of rows) {
    const key = activityDayKey(r.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, label: activityDate(r.at), items: [r] });
  }

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key} className="space-y-2.5">
          <h3 className="flex items-center gap-3 text-label font-semibold uppercase tracking-wide text-muted">
            {g.label}
            <span className="h-px flex-1 bg-line" />
          </h3>
          <ol className="relative space-y-2.5 pl-6">
            <span aria-hidden className="absolute bottom-2 left-[7px] top-3 w-0.5 bg-line" />
            {g.items.map((r) => (
              <li key={r.id} className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-[22px] top-4 h-3 w-3 rounded-full border-2 bg-surface ring-4 ring-canvas ${dotClass(r.kind)}`}
                />
                <div className="rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-line-strong">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ActorMark name={r.actorName} role={r.actorRole} />
                      <div className="min-w-0">
                        <p className="truncate text-body-strong text-ink">{r.summary}</p>
                        <p className="truncate text-caption text-muted">
                          {r.actorName} · {roleLabel(r.actorRole)} ·{" "}
                          {/* Exact time is the point of the page; the relative form is the
                              convenience. Both, always — never relative alone. */}
                          <time dateTime={r.at.toISOString()} title={activityStamp(r.at)}>
                            {activityTime(r.at)} IST
                          </time>{" "}
                          <span className="text-ink-3">({activityRelative(r.at)})</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-none flex-wrap items-center gap-1.5">
                      <Pill tone={KIND_TONE[r.kind]}>{r.actionLabel}</Pill>
                      <Pill tone="neutral">{r.section}</Pill>
                    </div>
                  </div>
                  <MetaDetails meta={r.meta} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function dotClass(kind: ActivityKind): string {
  switch (kind) {
    case "create": return "border-good";
    case "delete": return "border-bad";
    case "update": return "border-info";
    case "send": return "border-primary";
    case "auth": return "border-warn";
    default: return "border-line-strong";
  }
}

// ── table ──────────────────────────────────────────────────────

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) return <NoResults />;

  return (
    <TableShell
      head={
        <>
          <Th>When (IST)</Th>
          <Th>Who</Th>
          <Th>Action</Th>
          <Th>What</Th>
          <Th>Section</Th>
          <Th>Record</Th>
        </>
      }
    >
      {rows.map((r) => (
        <Tr key={r.id}>
          <Td>
            {/* To the second, and never relative here — this column is the evidence. */}
            <time dateTime={r.at.toISOString()} className="tnum whitespace-nowrap text-ink">
              {activityDate(r.at)}
            </time>
            <span className="tnum block whitespace-nowrap text-caption text-muted">{activityTime(r.at)}</span>
          </Td>
          <Td>
            <span className="whitespace-nowrap text-ink">{r.actorName}</span>
            <span className="block text-caption text-muted">{roleLabel(r.actorRole)}</span>
          </Td>
          <Td>
            <Pill tone={KIND_TONE[r.kind]}>{r.actionLabel}</Pill>
          </Td>
          <Td>
            <span className="text-ink-2">{r.summary}</span>
            <MetaDetails meta={r.meta} />
          </Td>
          <Td>
            <span className="text-caption text-muted">{r.section}</span>
          </Td>
          <Td>
            <span className="whitespace-nowrap text-caption text-muted">{r.entityType}</span>
            <span className="block font-mono text-xs text-ink-3">{r.entityId}</span>
          </Td>
        </Tr>
      ))}
    </TableShell>
  );
}

function NoResults() {
  return (
    <EmptyState
      title="Nothing matches"
      body="No activity for these filters. Clear them to see the full history."
    />
  );
}
