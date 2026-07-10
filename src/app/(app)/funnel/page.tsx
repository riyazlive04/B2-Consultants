import { Download, GraduationCap, IndianRupee, PhoneCall, Target } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { LEAD_SOURCE_LABELS } from "@/lib/labels";
import { requireSection } from "@/lib/rbac";
import { getFunnelOverview } from "@/server/funnel-metrics";
import { SnapshotForm } from "./_components/SnapshotForm";

export const dynamic = "force-dynamic";

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

export default async function FunnelPage({ searchParams }: { searchParams: { week?: string } }) {
  await requireSection("funnel"); // Admin-only (PRD3 §2)
  const data = await getFunnelOverview(searchParams.week);
  const current = data.months[data.months.length - 1];
  const maxStage = Math.max(1, ...data.funnel.map((s) => s.value));

  // 3-month norm for the carry-through INTO stage i — shown beside this month's
  // rate so every step reads as "actual vs usual", not a bare percentage.
  const stagesOf = (m: (typeof data.months)[number]) => [m.awareness, m.leads, m.calls, m.proposals, m.enrollTotal];
  const priorStages = data.months.slice(0, -1).map(stagesOf);
  const normInto = (i: number): number | null => {
    const rates = priorStages.filter((v) => v[i - 1] > 0).map((v) => (v[i] / v[i - 1]) * 100);
    return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  };

  // Metrics table rows: this month + last 3, side by side (PRD3 §3.3)
  const metricRows: Array<{ label: string; value: (m: (typeof data.months)[number]) => string }> = [
    { label: "Awareness → lead rate", value: (m) => formatPct(pct(m.leads, m.awareness)) },
    { label: "Lead → call rate", value: (m) => formatPct(pct(m.calls, m.leads)) },
    { label: "Call → proposal rate", value: (m) => formatPct(pct(m.proposals, m.calls)) },
    { label: "Proposal → enrollment rate", value: (m) => formatPct(pct(m.enrollTotal, m.proposals)) },
    { label: "Overall conversion rate", value: (m) => formatPct(pct(m.enrollTotal, m.leads)) },
    { label: "Solo enrollment %", value: (m) => formatPct(pct(m.enrollSolo, m.enrollTotal)) },
    { label: "Guided enrollment %", value: (m) => formatPct(pct(m.enrollGuided, m.enrollTotal)) },
    { label: "Elite enrollment %", value: (m) => formatPct(pct(m.enrollElite, m.enrollTotal)) },
    { label: "Ghosted Blueprint → call rate", value: (m) => formatPct(pct(m.gbCallsCompleted, m.ghostedDownloads)) },
    {
      label: "Revenue per lead",
      value: (m) => (m.leads > 0 ? formatInrMinor(m.revenueInr / m.leads, { compact: true }) : "-"),
    },
  ];

  const gb = data.ghostedBlueprint;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Conversion Funnel</h1>
        <p className="mt-1 text-sm text-muted">
          Free content → paid programs: where people stop, and what it costs. Weekly snapshots,
          not real-time.
        </p>
      </div>

      {/* Weakest-stage alert (PRD3 §3.3) — judged against the stage's own 3-month
          norm, not the raw drop (awareness → lead is ALWAYS the biggest raw drop). */}
      {data.biggestDrop ? (
        <div
          className={`rounded-card border p-5 shadow-card ${
            data.biggestDrop.severity === "risk" ? "border-risk bg-risk-soft" : "border-watch bg-watch-soft"
          }`}
        >
          <p className={`text-sm font-semibold ${data.biggestDrop.severity === "risk" ? "text-risk" : "text-watch"}`}>
            Weakest stage this month vs your 3-month norm
            {data.biggestDrop.severity === "watch" ? " (small miss — watch, don't panic)" : ""}
          </p>
          <p className="mt-1 font-display text-xl font-semibold">
            {data.biggestDrop.fromStage} → {data.biggestDrop.toStage} is carrying{" "}
            {formatPct(data.biggestDrop.currentPct)} — your norm is {formatPct(data.biggestDrop.avgPct)}.
          </p>
          <p className="tnum mt-1 text-sm text-muted">
            Getting this stage back to norm is the highest-leverage fix in the funnel right now.
          </p>
        </div>
      ) : !data.hasSnapshots ? (
        <div className="rounded-card border border-line bg-surface p-5 text-sm text-muted shadow-card">
          Enter weekly snapshots below to see the funnel and your weakest stage.
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-sm font-semibold" style={{ color: "var(--good)" }}>
            ✓ Every stage is at or above its 3-month norm
          </p>
          <p className="mt-1 text-sm text-muted">
            No stage is underperforming its own history this month — growth now comes from more volume at the top, not from fixing a leak.
          </p>
        </div>
      )}

      {/* Visual funnel: five blocks, narrowing (PRD3 §3.3) */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h3 className="mb-4 font-display text-lg font-semibold">This month - {current.label}</h3>
        <div className="flex flex-col items-center gap-1.5">
          {data.funnel.map((stage, i) => {
            const width = Math.max(18, (stage.value / maxStage) * 100);
            const isEnrolled = i === data.funnel.length - 1;
            const prev = i > 0 ? data.funnel[i - 1].value : 0;
            const carryPct = i > 0 && prev > 0 ? (stage.value / prev) * 100 : null;
            // §5.8: the biggest drop-off block is outlined/filled --bad so the
            // eye lands on the leak without reading the alert card.
            const isBiggestDrop = data.biggestDrop?.toStage === stage.name;
            const dropVar = data.biggestDrop?.severity === "risk" ? "bad" : "warn";
            return (
              <div key={stage.name} className="contents">
              {carryPct !== null && (
                <span
                  className={`text-[11px] tnum ${isBiggestDrop ? "font-semibold" : "text-muted"}`}
                  style={isBiggestDrop ? { color: `var(--${dropVar})` } : undefined}
                  title={`${data.funnel[i - 1].name} → ${stage.name}`}
                >
                  ↓ {formatPct(carryPct)} carry through
                  {normInto(i) !== null ? ` · norm ${formatPct(normInto(i)!)}` : ""}
                  {isBiggestDrop ? " — furthest below norm" : ""}
                </span>
              )}
              <div
                className="flex items-center justify-between gap-3 rounded-field px-4 py-3 text-sm"
                style={{
                  width: `${width}%`,
                  minWidth: "min(100%, 11rem)",
                  background: isBiggestDrop
                    ? `var(--${dropVar}-bg)`
                    : isEnrolled
                      ? "var(--good-bg)"
                      : "var(--primary-soft)",
                  color: isBiggestDrop ? `var(--${dropVar})` : isEnrolled ? "var(--good)" : "var(--primary)",
                  boxShadow: isBiggestDrop ? `inset 0 0 0 2px var(--${dropVar})` : undefined,
                }}
              >
                <span className="truncate font-medium">{i + 1}. {stage.name}</span>
                <span className="font-display text-base font-semibold tnum">
                  {stage.value.toLocaleString("en-IN")}
                </span>
              </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metrics table - this month + last 3 side by side */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr className="border-b border-line text-left text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Metric</th>
              {data.months.slice().reverse().map((m, i) => (
                <th key={m.key} className="px-4 py-3 text-right font-semibold">
                  {m.label}{i === 0 ? " (now)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label} className="border-b border-line last:border-b-0">
                <td className={`px-4 py-2.5 ${row.label === "Overall conversion rate" ? "font-semibold" : ""}`}>
                  {row.label}
                  {row.label === "Overall conversion rate" && (
                    <span
                      tabIndex={0}
                      aria-label="Enrollments ÷ leads captured in the month — how much of the top of the funnel becomes paying students."
                      title="Enrollments ÷ leads captured in the month — how much of the top of the funnel becomes paying students."
                      className="ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] leading-none text-muted"
                    >
                      i
                    </span>
                  )}
                </td>
                {data.months.slice().reverse().map((m) => (
                  <td key={m.key} className="tnum px-4 py-2.5 text-right">{row.value(m)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ghosted Blueprint tracker (PRD3 §3.4) */}
      <section>
        <h3 className="mb-3 font-display text-lg font-semibold">The Ghosted Blueprint</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Downloads all time" value={gb.totalDownloadsAllTime.toLocaleString("en-IN")} icon={<Download size={18} />} />
          <MetricCard label="Downloads this month" value={gb.downloadsThisMonth.toLocaleString("en-IN")} icon={<Download size={18} />} />
          <MetricCard label="→ Discovery call" value={formatPct(gb.downloadsToCallPct)} icon={<PhoneCall size={18} />} />
          <MetricCard label="→ Enrollment" value={formatPct(gb.downloadsToEnrollmentPct)} icon={<GraduationCap size={18} />} />
          <MetricCard
            label="→ Guided specifically"
            value={formatPct(gb.downloadsToGuidedPct)}
            secondary="the single most important outcome"
            signal={gb.totalDownloadsAllTime > 0 ? (gb.downloadsToGuidedPct >= 2 ? "ok" : "watch") : undefined}
            icon={<Target size={18} />}
          />
          <MetricCard
            label="Revenue attributed"
            value={formatInrMinor(gb.revenueInr, { compact: true })}
            secondary="students tagged Ghosted Blueprint"
            icon={<IndianRupee size={18} />}
          />
        </div>
      </section>

      {/* Source → enrollment attribution (report §3.D): which channel pays the bills */}
      {data.attribution.length > 0 && (
        <section>
          <h3 className="mb-1 font-display text-lg font-semibold">Source → enrollment attribution</h3>
          <p className="mb-3 text-xs text-muted">
            All time, from lead source tags on leads and students. Ad spend per channel isn’t
            captured yet, so CAC needs manual math - flagged as the accepted fallback.
          </p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                  {["Source", "Leads", "Calls done", "Won", "Students", "Revenue", "Revenue / lead"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 font-semibold ${i > 0 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.attribution.map((a) => (
                  <tr key={a.source} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 font-medium">{LEAD_SOURCE_LABELS[a.source] ?? a.source}</td>
                    <td className="tnum px-4 py-2.5 text-right">{a.leads}</td>
                    <td className="tnum px-4 py-2.5 text-right">{a.callsCompleted}</td>
                    <td className="tnum px-4 py-2.5 text-right">{a.won}</td>
                    <td className="tnum px-4 py-2.5 text-right">{a.students}</td>
                    <td className="tnum px-4 py-2.5 text-right font-semibold">
                      {formatInrMinor(a.revenueInr, { compact: true })}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {a.revenuePerLeadInr === null ? "-" : formatInrMinor(a.revenuePerLeadInr, { compact: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Weekly entry */}
      <SnapshotForm entry={data.entry} />

      {/* Recent snapshots */}
      {data.recentSnapshots.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                {["Week", "Awareness", "Leads", "Calls", "Proposals", "Enrollments", "GB downloads", "Workshop", "Notes"].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recentSnapshots.map((s) => (
                <tr key={s.weekStart} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <a href={`/funnel?week=${s.weekStart.slice(0, 10)}`} className="text-accent hover:underline tnum">
                      {formatDate(s.weekStart)}
                    </a>
                  </td>
                  <td className="tnum px-4 py-2.5">{s.awarenessReach.toLocaleString("en-IN")}</td>
                  <td className="tnum px-4 py-2.5">{s.leadsCaptured}</td>
                  <td className="tnum px-4 py-2.5">{s.callsCompleted}</td>
                  <td className="tnum px-4 py-2.5">{s.proposalsSent}</td>
                  <td className="tnum px-4 py-2.5">{s.enrollments}</td>
                  <td className="tnum px-4 py-2.5">{s.ghostedDownloads}</td>
                  <td className="tnum px-4 py-2.5">{s.workshopAttendees}</td>
                  <td className="max-w-64 truncate px-4 py-2.5 text-muted">{s.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
