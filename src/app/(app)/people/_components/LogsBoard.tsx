"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addLogCorrection } from "@/server/people-actions";
import type { PeopleOverview } from "@/server/people-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { formatDate, formatMonth } from "@/lib/format";
import { LOG_FIELD_SHORT } from "@/lib/labels";

type LogRow = PeopleOverview["logs"][number];

/** Admin daily-log board: today's status (live 7PM badge via light polling), rollups, all logs. */
export function LogsBoard({
  members,
  weeklyRollup,
  monthlyRollup,
  logs,
}: {
  members: PeopleOverview["members"];
  weeklyRollup: PeopleOverview["weeklyRollup"];
  monthlyRollup: PeopleOverview["monthlyRollup"];
  logs: LogRow[];
}) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState<LogRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live badge (CONTEXT §7): server-computed on load + light polling every 60s.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  const loggers = members.filter((m) => m.logsDaily);

  const valuesText = (r: LogRow) =>
    Object.entries(r.values)
      .map(([k, v]) => `${LOG_FIELD_SHORT[k] ?? k}: ${v}`)
      .join(" · ");

  const columns: Column<LogRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    { key: "user", header: "Member", cell: (r) => r.user, value: (r) => r.user },
    { key: "values", header: "Numbers", cell: (r) => valuesText(r), value: (r) => valuesText(r) },
    { key: "notes", header: "Notes / blockers", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "correction", header: "Correction",
      cell: (r) =>
        r.correctionNote ? (
          <span className="text-watch">{r.correctionNote}</span>
        ) : (
          <Btn variant="ghost" size="sm" onClick={() => setCorrecting(r)}>
            Add note
          </Btn>
        ),
      value: (r) => r.correctionNote ?? "",
    },
  ];

  return (
    <section className="space-y-6">
      {/* Today's submission status */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">Today</h3>
        <div className="flex flex-wrap gap-3">
          {loggers.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
              <span className="font-medium">{m.fullName}</span>
              {m.streak > 1 && (
                <span className="text-xs text-muted" title={`${m.streak}-day logging streak`}>
                  🔥{m.streak}
                </span>
              )}
              {m.submittedToday ? (
                <Pill tone="good">Logged ✓</Pill>
              ) : m.missingLogBadge ? (
                <Pill tone="warn" title="No log by 7:00 PM IST">⚠ Missing log</Pill>
              ) : (
                <Pill tone="neutral">Pending</Pill>
              )}
            </div>
          ))}
          {loggers.length === 0 && <p className="text-sm text-muted">No active logging members.</p>}
        </div>
      </div>

      {/* Weekly rollup */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">Weekly totals</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {weeklyRollup.map(({ user, weeks }) => {
            const metricKeys = [...new Set(weeks.flatMap((w) => Object.keys(w.sums)))];
            const maxVal = Math.max(1, ...weeks.flatMap((w) => Object.values(w.sums)));
            return (
              <div key={user} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <p className="mb-3 font-semibold">{user}</p>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[16rem] text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 pr-2 font-medium">Week of</th>
                      {metricKeys.map((k) => (
                        <th key={k} className="px-1 py-1 text-right font-medium">{LOG_FIELD_SHORT[k] ?? k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w.week} className="border-t border-line">
                        <td className="py-1.5 pr-2 tnum">{formatDate(w.week)}</td>
                        {metricKeys.map((k) => {
                          const v = w.sums[k] ?? 0;
                          return (
                            <td key={k} className="px-1 py-1.5 text-right">
                              <span className="tnum">{v}</span>
                              <span
                                className="ml-1 inline-block h-2 rounded-sm bg-accent-soft align-middle"
                                style={{ width: `${Math.round((v / maxVal) * 28) + 2}px` }}
                                aria-hidden
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}
          {weeklyRollup.length === 0 && <p className="text-sm text-muted">No logs submitted yet.</p>}
        </div>
      </div>

      {/* Monthly rollup (PRD2 §3.3) */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">Monthly totals</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {monthlyRollup.map(({ user, months }) => {
            const metricKeys = [...new Set(months.flatMap((m) => Object.keys(m.sums)))];
            const maxVal = Math.max(1, ...months.flatMap((m) => Object.values(m.sums)));
            return (
              <div key={user} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <p className="mb-3 font-semibold">{user}</p>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[16rem] text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 pr-2 font-medium">Month</th>
                      {metricKeys.map((k) => (
                        <th key={k} className="px-1 py-1 text-right font-medium">{LOG_FIELD_SHORT[k] ?? k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => (
                      <tr key={m.month} className="border-t border-line">
                        <td className="py-1.5 pr-2 tnum">{formatMonth(`${m.month}-01`)}</td>
                        {metricKeys.map((k) => {
                          const v = m.sums[k] ?? 0;
                          return (
                            <td key={k} className="px-1 py-1.5 text-right">
                              <span className="tnum">{v}</span>
                              <span
                                className="ml-1 inline-block h-2 rounded-sm bg-accent-soft align-middle"
                                style={{ width: `${Math.round((v / maxVal) * 28) + 2}px` }}
                                aria-hidden
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            );
          })}
          {monthlyRollup.length === 0 && <p className="text-sm text-muted">No logs submitted yet.</p>}
        </div>
      </div>

      {/* Correction note (append-only guarantee: original numbers are immutable) */}
      {correcting && (
        <Card>
        <form
          action={async (form) => {
            setError(null);
            const res = await addLogCorrection(correcting.id, form);
            if (!res.ok) return setError(res.error);
            setCorrecting(null);
          }}
        >
          <p className="mb-3 text-sm">
            Correction note for <strong>{correcting.user}</strong> - {formatDate(correcting.date)}.
            The original entry stays intact.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-64 flex-1">
              <TextInput name="correctionNote" required placeholder="e.g. Actually 6 calls - one logged twice" />
            </div>
            <SubmitButton>Save note</SubmitButton>
            <Btn variant="ghost" onClick={() => setCorrecting(null)}>
              Cancel
            </Btn>
            <FormError message={error} />
          </div>
        </form>
        </Card>
      )}

      {/* All logs */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">All daily logs</h3>
        <DataTable rows={logs} columns={columns} csvName="daily-logs" filterPlaceholder="Filter logs…" />
      </div>
    </section>
  );
}
