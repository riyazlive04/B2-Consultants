import Link from "next/link";
import {
  Users,
  Layers,
  GraduationCap,
  UserMinus,
  UserCheck,
  Smile,
  Star,
  Crown,
  LifeBuoy,
  Rocket,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { JourneyRing, MomentumChip } from "@/components/ui/gamification";
import { Tabs } from "@/components/ui/Tabs";
import { Card, CardTitle, PageHeader, Pill } from "@/components/ui/kit";
import { formatInrMinor, formatPct } from "@/lib/format";
import { istToday, toDateInputValue } from "@/lib/dates";
import { requireSection } from "@/lib/rbac";
import { getStudentsOverview } from "@/server/students-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { StudentsPanel } from "./_components/StudentsPanel";
import { BookOrdersPanel } from "./_components/BookOrdersPanel";
import { ImportPanel } from "./_components/ImportPanel";
import { getBookOrderData, getStudentOptions } from "@/server/book-order-metrics";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { TrackerTable } from "./_components/TrackerTable";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const session = await requireSection("students"); // Admin full, Head view (PRD2 §2)
  const isAdmin = session.role === "ADMIN";
  const { counts, avgSatisfaction, avgNps, tracker, momentumBoard, atRiskRadar, ltvSummary, students } =
    await getStudentsOverview();
  const waByStudent = await getWhatsAppStatusMap("studentId", tracker.map((t) => t.studentId));
  const today = toDateInputValue(istToday());
  // Book orders and Import are Admin-only tabs — a Head shouldn't pay for reads they can't see.
  const [bookOrders, studentOptions] = isAdmin
    ? await Promise.all([getBookOrderData(), getStudentOptions()])
    : [{ rows: [], vendors: [], thresholdRupees: 0 }, []];
  // Book orders are per single level (never a bundle).
  const bookLevelOptions = isAdmin
    ? levelOptions(await getActiveLevels(), ["GERMAN_LEVEL", "COACHING_TIER", "OTHER"])
    : [];

  return (
    <div className="w-full space-y-8">
      <PageHeader
        icon={<GraduationCap size={20} />}
        title="Students"
        subtitle="B2 Consultants students only (Solo / Guided / Elite). German Note comes in a later phase."
      />

      {/* Count dashboard (PRD2 §4.2) + always-visible satisfaction averages (§4.5) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="Total active students" value={counts.totalActive} icon={<Users size={18} />} />
        <MetricCard
          label="Active by level"
          value={
            <span className="text-2xl">
              {counts.activeSolo} · {counts.activeGuided} · {counts.activeElite}
            </span>
          }
          secondary="Solo · Guided · Elite"
          icon={<Layers size={18} />}
        />
        <MetricCard label="Completed this month" value={counts.completedThisMonth} signal={counts.completedThisMonth > 0 ? "ok" : undefined} icon={<GraduationCap size={18} />} />
        <MetricCard label="Dropped this month" value={counts.droppedThisMonth} signal={counts.droppedThisMonth > 0 ? "risk" : undefined} icon={<UserMinus size={18} />} />
        <MetricCard label="Enrolled all time" value={counts.totalAllTime} icon={<UserCheck size={18} />} />
        <MetricCard
          label="Avg satisfaction"
          value={avgSatisfaction === null ? "-" : avgSatisfaction.toFixed(1)}
          secondary="out of 10, completed students"
          progress={avgSatisfaction === null ? undefined : avgSatisfaction / 10}
          icon={<Smile size={18} />}
        />
        <MetricCard
          label="Avg NPS"
          value={avgNps === null ? "-" : avgNps.toFixed(1)}
          secondary="out of 10"
          progress={avgNps === null ? undefined : avgNps / 10}
          icon={<Star size={18} />}
        />
        <MetricCard
          label="Highest LTV student"
          value={
            ltvSummary.highest ? (
              <span className="text-2xl">{ltvSummary.highest.name}</span>
            ) : (
              "-"
            )
          }
          secondary={ltvSummary.highest ? formatInrMinor(ltvSummary.highest.ltvInr, { compact: true }) : "no linked income yet"}
          icon={<Crown size={18} />}
        />
      </div>

      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Average LTV:</span>{" "}
        Solo {formatInrMinor(ltvSummary.avgSolo, { compact: true })} · Guided{" "}
        {formatInrMinor(ltvSummary.avgGuided, { compact: true })} · Elite{" "}
        {formatInrMinor(ltvSummary.avgElite, { compact: true })} ·{" "}
        <span className="font-medium text-ink">Upgrade rate:</span> {formatPct(ltvSummary.upgradeRatePct)}
      </p>

      {/* Momentum board — gamified journey showcase: who's moving fastest right now.
          Derived from milestones + sessions + activity recency; nothing extra to enter. */}
      {momentumBoard.length > 0 && (
        <Card
          title={<CardTitle icon={<Rocket size={18} />}>Momentum board</CardTitle>}
          subtitle="Journey XP = milestones covered + sessions + applications + interviews. Use it in check-ins — students love seeing their bar move."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {momentumBoard.map((t, i) => (
              <Link
                key={t.enrollmentId}
                href={`/students/${t.studentId}`}
                className="card-hover flex items-center gap-3 rounded-card border border-line bg-surface-2 p-4"
              >
                <JourneyRing pct={t.journeyPct} stageIndex={t.stageIndex} size={56} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {["🥇 ", "🥈 ", "🥉 "][i]}
                    {t.studentName}
                  </p>
                  <p className="tnum text-xs text-muted">
                    {t.stageTitle} · {t.journeyXp.toLocaleString("en-IN")} XP
                  </p>
                  {t.momentum && (
                    <div className="mt-1.5">
                      <MomentumChip momentum={t.momentum} size="sm" />
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Early-warning radar (report §3.B): machine-detected disengagement, human decides.
          Suggestions only - the manual G/A/R signal remains the source of truth. */}
      {atRiskRadar.length > 0 && (
        <Card
          title={<CardTitle icon={<LifeBuoy size={18} className="text-watch" />}>Early-warning radar</CardTitle>}
          subtitle="Auto-detected from sessions, check-ins, tasks and pace. Review and set the signal colour yourself - the radar suggests, you decide."
        >
          <ul className="space-y-2">
            {atRiskRadar.map((t) => (
              <li key={t.enrollmentId} className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
                <Link href={`/students/${t.studentId}`} className="font-semibold text-accent hover:underline">
                  {t.studentName}
                </Link>
                <span className="text-xs text-muted">
                  {t.programLevel === "GUIDED" ? "Guided" : "Elite"} · Day {t.dayNumber}/{t.totalDays}
                </span>
                {t.alreadyRed && <Pill tone="bad">already RED</Pill>}
                <span className="ml-auto flex flex-wrap justify-end gap-1">
                  {t.flags.map((f) => (
                    <Pill key={f} tone="warn">{f}</Pill>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        tabs={[
          {
            label: `90/120-day tracker${tracker.some((t) => t.signalColour === "RED") ? " ⚠" : ""}`,
            content: <TrackerTable rows={tracker} isAdmin={isAdmin} waStatus={waByStudent} />,
          },
          { label: "All students & LTV", content: <StudentsPanel rows={students} isAdmin={isAdmin} today={today} /> },
          ...(isAdmin
            ? [
                {
                  label: `Book orders${bookOrders.rows.filter((r) => r.readyToRelease).length ? " ●" : ""}`,
                  content: (
                    <BookOrdersPanel
                      rows={bookOrders.rows}
                      vendors={bookOrders.vendors}
                      students={studentOptions}
                      thresholdRupees={bookOrders.thresholdRupees}
                      levelOptions={bookLevelOptions}
                    />
                  ),
                },
                { label: "Import", content: <ImportPanel /> },
              ]
            : []),
        ]}
      />
    </div>
  );
}
