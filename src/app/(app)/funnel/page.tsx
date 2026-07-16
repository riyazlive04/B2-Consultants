import { Download, Filter, GraduationCap, IndianRupee, PhoneCall, Target } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card, PageHeader } from "@/components/ui/kit";
import { formatPct, formatInrMinor } from "@/lib/format";
import { requireSection } from "@/lib/rbac";
import { getFunnelOverview } from "@/server/funnel-metrics";
import { SnapshotForm } from "./_components/SnapshotForm";
import { FunnelMetricsTable, FunnelAttributionTable, FunnelSnapshotsTable } from "./_components/FunnelTables";

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

  const gb = data.ghostedBlueprint;

  return (
    <div className="w-full space-y-8">
      <PageHeader
        icon={<Filter size={20} />}
        title="Conversion Funnel"
        subtitle="Free content → paid programs: where people stop, and what it costs. Weekly snapshots, not real-time."
      />

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
          <p className="mt-1 font-display text-h2">
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
      <Card title={`This month - ${current.label}`}>
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
                  className={`text-caption tnum ${isBiggestDrop ? "font-semibold" : "text-muted"}`}
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
      </Card>

      {/* Metrics table - this month + last 3 side by side */}
      <FunnelMetricsTable months={data.months} />

      {/* Ghosted Blueprint tracker (PRD3 §3.4) */}
      <section>
        <h3 className="mb-3 font-display text-h3">The Ghosted Blueprint</h3>
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
          <h3 className="mb-1 font-display text-h3">Source → enrollment attribution</h3>
          <p className="mb-3 text-xs text-muted">
            All time, from lead source tags on leads and students. Ad spend per channel isn’t
            captured yet, so CAC needs manual math - flagged as the accepted fallback.
          </p>
          <FunnelAttributionTable attribution={data.attribution} />
        </section>
      )}

      {/* Weekly entry */}
      <SnapshotForm entry={data.entry} />

      {/* Recent snapshots */}
      {data.recentSnapshots.length > 0 && (
        <FunnelSnapshotsTable snapshots={data.recentSnapshots} />
      )}
    </div>
  );
}
