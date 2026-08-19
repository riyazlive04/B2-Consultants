"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/kit";
import { Select } from "@/components/ui/form";
import { firstCallVerdict, firstCallLabel, formatAge, type FirstCallState } from "@/lib/speed-to-lead";
import { formatDateTimeInZone } from "@/lib/format";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { getSpeedToLeadBoardReport, type SpeedToLeadBoardReport } from "@/server/opportunities-actions";

/**
 * "Speed to lead" - the popup behind the button on the pipeline board.
 *
 * One question, answered two ways: per setter (how many leads, how many called, how many inside
 * five minutes, the median) and per lead (opt-in, first call, the verdict). The same verdict rule
 * the card colours use - `firstCallVerdict` - so a card and this table can never disagree.
 */

const RANGE_OPTS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

const TONE: Record<FirstCallState, "good" | "bad" | "warn" | "neutral"> = {
  HIT: "good",
  LATE: "bad",
  OVERDUE: "bad",
  DUE: "warn",
};

export function SpeedToLeadReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [days, setDays] = useState("7");
  const [report, setReport] = useState<SpeedToLeadBoardReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    getSpeedToLeadBoardReport(Number(days))
      .then((r) => { if (live) setReport(r); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, days]);

  const now = report ? new Date(report.generatedAt) : new Date();
  const totals = report?.owners.reduce(
    (t, o) => ({ leads: t.leads + o.leads, called: t.called + o.called, withinFive: t.withinFive + o.withinFive, overdue: t.overdue + o.overdue }),
    { leads: 0, called: 0, withinFive: 0, overdue: 0 },
  );
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

  return (
    <Modal open={open} onClose={onClose} title="Speed to lead" subtitle="Time from opt-in to the first call - target 5 minutes" size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select size="sm" value={days} onChange={(e) => setDays(e.target.value)} options={RANGE_OPTS} className="w-44" />
          {report && (
            <p className="text-caption text-ink-3">
              {report.truncated ? `Showing the latest 300 of ` : ""}{totals?.leads ?? 0} lead{totals?.leads === 1 ? "" : "s"} · as of {formatDateTimeInZone(now, "Asia/Kolkata")} IST
            </p>
          )}
        </div>

        {/* Headline tiles */}
        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Leads", String(totals.leads), undefined],
              ["Called", `${totals.called} · ${pct(totals.called, totals.leads)}`, undefined],
              ["Within 5 min", `${totals.withinFive} · ${pct(totals.withinFive, totals.leads)}`, "var(--good)"],
              ["Overdue, uncalled", String(totals.overdue), totals.overdue ? "var(--bad)" : undefined],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-field border border-line bg-surface-2 px-3 py-2">
                <p className="text-caption font-semibold uppercase tracking-wide text-ink-3">{label}</p>
                <p className="tnum text-lg font-semibold" style={{ color: color ?? "var(--ink)" }}>{loading ? "…" : value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Per setter */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">By setter</h3>
          <div className="overflow-x-auto rounded-field border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-caption uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Setter</th>
                  <th className="px-3 py-2 text-right font-semibold">Leads</th>
                  <th className="px-3 py-2 text-right font-semibold">Called</th>
                  <th className="px-3 py-2 text-right font-semibold">Within 5 min</th>
                  <th className="px-3 py-2 text-right font-semibold">Median</th>
                  <th className="px-3 py-2 text-right font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!report || loading ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-3">Loading…</td></tr>
                ) : report.owners.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-3">No leads in this period.</td></tr>
                ) : (
                  report.owners.map((o) => {
                    const hit = o.leads ? o.withinFive / o.leads : 0;
                    return (
                      <tr key={o.ownerId ?? "unassigned"}>
                        <td className="px-3 py-2 font-medium text-ink">{o.ownerName}</td>
                        <td className="tnum px-3 py-2 text-right">{o.leads}</td>
                        <td className="tnum px-3 py-2 text-right">{o.called} <span className="text-ink-3">({pct(o.called, o.leads)})</span></td>
                        <td className="tnum px-3 py-2 text-right font-semibold" style={{ color: o.leads ? (hit >= 0.9 ? "var(--good)" : hit >= 0.75 ? "var(--warn)" : "var(--bad)") : undefined }}>
                          {o.withinFive} <span className="font-normal text-ink-3">({pct(o.withinFive, o.leads)})</span>
                        </td>
                        <td className="tnum px-3 py-2 text-right">{o.medianMinutes === null ? "-" : formatAge(Math.round(o.medianMinutes))}</td>
                        <td className="tnum px-3 py-2 text-right" style={{ color: o.overdue ? "var(--bad)" : undefined }}>{o.overdue}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Per lead */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">By lead</h3>
          <div className="max-h-[40vh] overflow-auto rounded-field border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-caption uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Lead</th>
                  <th className="px-3 py-2 text-left font-semibold">Setter</th>
                  <th className="px-3 py-2 text-left font-semibold">Opted in</th>
                  <th className="px-3 py-2 text-left font-semibold">First call</th>
                  <th className="px-3 py-2 text-left font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!report || loading ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-3">Loading…</td></tr>
                ) : report.rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-3">No leads in this period.</td></tr>
                ) : (
                  report.rows.map((r) => {
                    const v = firstCallVerdict(new Date(r.optInAt), r.firstCallAt ? new Date(r.firstCallAt) : null, now);
                    return (
                      <tr key={r.leadId}>
                        <td className="px-3 py-2">
                          <Link href={`/contacts/${r.leadId}`} className="font-medium text-ink hover:text-primary hover:underline">{r.name}</Link>
                          <span className="block text-caption text-ink-3">{LEAD_STAGE_LABELS[r.stage as keyof typeof LEAD_STAGE_LABELS] ?? r.stage}</span>
                        </td>
                        <td className="px-3 py-2 text-ink-2">{r.ownerName ?? <span className="text-ink-3">Unassigned</span>}</td>
                        <td className="tnum px-3 py-2 text-ink-2">{formatDateTimeInZone(new Date(r.optInAt), "Asia/Kolkata")}</td>
                        <td className="tnum px-3 py-2 text-ink-2">{r.firstCallAt ? formatDateTimeInZone(new Date(r.firstCallAt), "Asia/Kolkata") : <span className="text-ink-3">not yet</span>}</td>
                        <td className="px-3 py-2"><Pill tone={TONE[v.state]}>{firstCallLabel(v)}</Pill></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Modal>
  );
}
