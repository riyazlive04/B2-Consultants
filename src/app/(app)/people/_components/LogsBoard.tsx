"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { addLogCorrection } from "@/server/people-actions";
import type { PeopleOverview } from "@/server/people-metrics";
import type { LogEntry } from "@/lib/daily-log";
import { ActivityTimeline } from "@/components/ui/activity";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { formatDate, formatMonth } from "@/lib/format";
import { LOG_FIELD_SHORT } from "@/lib/labels";

/** Admin daily-log board: today's roster (live 7PM badge), the team activity feed, and rollups. */
export function LogsBoard({
  members,
  weeklyRollup,
  monthlyRollup,
  entries,
}: {
  members: PeopleOverview["members"];
  weeklyRollup: PeopleOverview["weeklyRollup"];
  monthlyRollup: PeopleOverview["monthlyRollup"];
  entries: PeopleOverview["entries"];
}) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState<{ id: string; name: string; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live badge (CONTEXT §7): server-computed on load + light polling every 60s.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  const loggers = members.filter((m) => m.logsDaily);

  const onCorrect = (entry: LogEntry) =>
    setCorrecting({ id: entry.id, name: entry.person?.name ?? "member", date: entry.dateLabel });

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

      {/* Correction note (append-only guarantee: original numbers are immutable) */}
      {correcting && (
        <Card>
          <form
            action={async (form) => {
              setError(null);
              const res = await addLogCorrection(correcting.id, form);
              if (!res.ok) return setError(res.error);
              setCorrecting(null);
              router.refresh();
            }}
          >
            <p className="mb-3 text-sm">
              Correction note for <strong>{correcting.name}</strong> - {correcting.date}.
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

      {/* Team activity feed */}
      <div>
        <h3 className="mb-3 font-display text-h2 font-semibold">Team activity</h3>
        <ActivityTimeline
          entries={entries}
          mode="team"
          onCorrect={onCorrect}
          pageSize={10}
          emptyTitle="No logs submitted yet"
          emptyBody="Daily logs from the team will appear here as they come in."
        />
      </div>

      {/* Weekly + monthly rollups — reference totals, tucked away to keep the feed the focus */}
      <details className="group rounded-card border border-line bg-surface shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span className="font-display text-h3 font-semibold text-ink">Weekly &amp; monthly totals</span>
          <ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-line p-5">
          {/* Weekly rollup */}
          <div>
            <h4 className="mb-3 text-label font-semibold uppercase text-muted">Weekly totals</h4>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {weeklyRollup.map(({ user, weeks }) => {
                const metricKeys = [...new Set(weeks.flatMap((w) => Object.keys(w.sums)))];
                const maxVal = Math.max(1, ...weeks.flatMap((w) => Object.values(w.sums)));
                return (
                  <div key={user} className="rounded-field border border-line bg-surface-2 p-4">
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
            <h4 className="mb-3 text-label font-semibold uppercase text-muted">Monthly totals</h4>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {monthlyRollup.map(({ user, months }) => {
                const metricKeys = [...new Set(months.flatMap((m) => Object.keys(m.sums)))];
                const maxVal = Math.max(1, ...months.flatMap((m) => Object.values(m.sums)));
                return (
                  <div key={user} className="rounded-field border border-line bg-surface-2 p-4">
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
        </div>
      </details>
    </section>
  );
}
