import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Layers,
  CalendarRange,
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
import { Card, CardTitle, EngineOffNotice, PageHeader, Pill } from "@/components/ui/kit";
import { enginesOff } from "@/server/engine-status";
import { formatInrMinor, formatPct } from "@/lib/format";
import { istToday, toDateInputValue } from "@/lib/dates";
import { requireSection } from "@/lib/rbac";
import { SectionLink } from "@/components/ui/SectionLink";
import { getStudentsOverview } from "@/server/students-metrics";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { StudentsPanel } from "./_components/StudentsPanel";
import { BookOrdersPanel } from "./_components/BookOrdersPanel";
import { ImportPanel } from "./_components/ImportPanel";
import { getBookOrderData, getStudentOptions } from "@/server/book-order-metrics";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { TrackerTable } from "./_components/TrackerTable";
import { TrackerBatchForm } from "./_components/TrackerBatchForm";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Students" };

export const dynamic = "force-dynamic";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const session = await requireSection("students"); // Admin full, Head view (PRD2 §2)
  const isAdmin = session.role === "ADMIN";

  /*
    COHORTS LEFT THIS PAGE (refactor step E4).

    The Batches tab mounted the very same `BatchesManager` that /batches tab 0 mounts, so there
    were two editors for one set of cohorts - change a date in one and the other was stale until
    reloaded. /batches is the home: it holds both lines and the plans beside them.

    Bookmarks are redirected rather than broken, which is why this is index arithmetic and not a
    deletion. For an ADMIN the tabs were: 0 tracker · 1 weekly update · 2 all students ·
    3 book orders · 4 BATCHES · 5 import. `canEditTracker` is always true for an admin, so those
    indices are fixed, and the tab only ever existed for an admin - a Head or anyone else never
    had it and needs no remap.
  */
  if (isAdmin) {
    if (searchParams?.tab === "4" || searchParams?.tab === "batches") redirect("/batches?tab=0");
    if (searchParams?.tab === "5") redirect("/students?tab=4");
  }
  // Mirrors `updateTracker`'s own `requireAdminOrHead` gate - the weekly-round form is only
  // offered to people the server will actually accept a write from.
  const canEditTracker = isAdmin || session.role === "HEAD";
  // The only message the app sends on enrolment. Off, a student who has just paid hears nothing.
  const enginesDown = await enginesOff(["studentWelcome"]);
  const { counts, avgSatisfaction, avgNps, satisfactionBreakdown, npsBreakdown, tracker, momentumBoard, atRiskRadar, ltvSummary, students, coaches, defaultCoach } =
    await getStudentsOverview();
  const waByStudent = await getWhatsAppStatusMap("studentId", tracker.map((t) => t.studentId));
  const today = toDateInputValue(istToday());
  // Book orders, Batches and Import are Admin-only tabs - a Head shouldn't pay for reads they
  // can't see. Creating and archiving a batch is Admin-only in `upsertBatch` for the same reason.
  // `getBatchBoard("B2")` used to be loaded here for the Batches tab. It went with the tab - one
  // fewer query on a screen the founders open all day, and the cohort board pays for its own.
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
        actions={
          isAdmin ? (
            <SectionLink href="/batches" sectionKey="batches">
              <CalendarRange size={14} /> Batches &amp; plans
            </SectionLink>
          ) : undefined
        }
      />

      {/* Built, and switched off - said on the screen it affects rather than only on the
          Console, because an engine nobody armed is indistinguishable from a broken one. */}
      <EngineOffNotice engines={enginesDown} canOpenConsole={session.role === "ADMIN"} />

      {/* Count dashboard (PRD2 §4.2) + always-visible satisfaction averages (§4.5) */}
      {/* One card per row until ~480px: two KPI cards on a 320-375px phone left each label
          about 19px of width, so every one of these eight read as "TO A…" / "AC B…". */}
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="Total active students"
          value={counts.totalActive}
          icon={<Users size={18} />}
          detail={{
            rows: [
              { label: "Solo", value: counts.activeSolo },
              { label: "Guided", value: counts.activeGuided },
              { label: "Elite", value: counts.activeElite },
            ],
          }}
        />
        <MetricCard
          label="Active by level"
          value={
            <span className="text-2xl">
              {counts.activeSolo} · {counts.activeGuided} · {counts.activeElite}
            </span>
          }
          secondary="Solo · Guided · Elite"
          icon={<Layers size={18} />}
          detail={{
            rows: [
              { label: "Solo", value: counts.activeSolo },
              { label: "Guided", value: counts.activeGuided },
              { label: "Elite", value: counts.activeElite },
            ],
          }}
        />
        <MetricCard
          label="Completed this month"
          value={counts.completedThisMonth}
          signal={counts.completedThisMonth > 0 ? "ok" : undefined}
          icon={<GraduationCap size={18} />}
          detail={{
            rows: [
              { label: "Solo", value: counts.completedThisMonthByLevel.SOLO },
              { label: "Guided", value: counts.completedThisMonthByLevel.GUIDED },
              { label: "Elite", value: counts.completedThisMonthByLevel.ELITE },
            ],
          }}
        />
        {/*
          WHY they stopped, not only how many (@39:42).
          The reasons come first in the popup, because "two Guided students" is a fact nobody
          can act on and "two left for financial reasons" is a conversation with Finance. The
          levels stay underneath - the card's own number is still a headcount.
        */}
        <MetricCard
          label="Dropped this month"
          value={counts.droppedThisMonth}
          signal={counts.droppedThisMonth > 0 ? "risk" : undefined}
          icon={<UserMinus size={18} />}
          detail={{
            rows: [
              ...counts.droppedThisMonthReasons.map((r) => ({
                label: r.reason,
                value: `${r.count} (${r.pct}%)`,
              })),
              { label: "Solo", value: counts.droppedThisMonthByLevel.SOLO },
              { label: "Guided", value: counts.droppedThisMonthByLevel.GUIDED },
              { label: "Elite", value: counts.droppedThisMonthByLevel.ELITE },
            ],
          }}
        />
        <MetricCard
          label="Enrolled all time"
          value={counts.totalAllTime}
          icon={<UserCheck size={18} />}
          detail={{
            rows: [
              { label: "Active", value: counts.totalActive },
              { label: "Completed", value: counts.totalCompletedAllTime },
              { label: "Dropped", value: counts.totalDroppedAllTime },
              /*
                All-time reasons live HERE rather than on the monthly card, and that is the
                point of carrying both: one month of churn on a business this size is two or
                three rows, which is an anecdote. This is the only window with enough of them
                to be a pattern worth changing the programme over.
              */
              ...counts.droppedAllTimeReasons.map((r) => ({
                label: `… ${r.reason}`,
                value: `${r.count} (${r.pct}%)`,
              })),
            ],
          }}
        />
        <MetricCard
          label="Avg satisfaction"
          value={avgSatisfaction === null ? "-" : avgSatisfaction.toFixed(1)}
          secondary="out of 10, completed students"
          progress={avgSatisfaction === null ? undefined : avgSatisfaction / 10}
          icon={<Smile size={18} />}
          detail={{
            rows: [
              { label: "Sample size", value: satisfactionBreakdown.sampleSize },
              { label: "Testimonials received", value: satisfactionBreakdown.testimonialsReceived },
              { label: "Job offers received", value: satisfactionBreakdown.jobOffersReceived },
            ],
          }}
        />
        <MetricCard
          label="Avg recommend score"
          value={avgNps === null ? "-" : avgNps.toFixed(1)}
          secondary="out of 10"
          progress={avgNps === null ? undefined : avgNps / 10}
          icon={<Star size={18} />}
          detail={{
            rows: [
              { label: "Promoters (9-10)", value: npsBreakdown.promoters },
              { label: "Passives (7-8)", value: npsBreakdown.passives },
              { label: "Detractors (0-6)", value: npsBreakdown.detractors },
            ],
          }}
        />
        <MetricCard
          label="Top paying student"
          value={
            ltvSummary.highest ? (
              <span className="text-2xl">{ltvSummary.highest.name}</span>
            ) : (
              "-"
            )
          }
          secondary={ltvSummary.highest ? formatInrMinor(ltvSummary.highest.ltvInr, { compact: true }) : "no linked income yet"}
          icon={<Crown size={18} />}
          detail={{
            rows: [
              { label: "Avg paid - Solo", value: formatInrMinor(ltvSummary.avgSolo, { compact: true }) },
              { label: "Avg paid - Guided", value: formatInrMinor(ltvSummary.avgGuided, { compact: true }) },
              { label: "Avg paid - Elite", value: formatInrMinor(ltvSummary.avgElite, { compact: true }) },
              { label: "Upgrade rate", value: formatPct(ltvSummary.upgradeRatePct) },
            ],
          }}
        />
      </div>

      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Average paid:</span>{" "}
        Solo {formatInrMinor(ltvSummary.avgSolo, { compact: true })} · Guided{" "}
        {formatInrMinor(ltvSummary.avgGuided, { compact: true })} · Elite{" "}
        {formatInrMinor(ltvSummary.avgElite, { compact: true })} ·{" "}
        <span className="font-medium text-ink">Upgrade rate:</span> {formatPct(ltvSummary.upgradeRatePct)}
      </p>

      {/* Momentum board - gamified journey showcase: who's moving fastest right now.
          Derived from milestones + sessions + activity recency; nothing extra to enter. */}
      {momentumBoard.length > 0 && (
        <Card
          title={<CardTitle icon={<Rocket size={18} />}>Momentum board</CardTitle>}
          subtitle="Journey XP = milestones covered + sessions + applications + interviews. Use it in check-ins - students love seeing their bar move."
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
        {/* Keeps the open tab in the address, so a refresh (or a shared link) does not drop
            back to the first tab (issue 28). */}
      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: `90/120-day tracker${tracker.some((t) => t.signalColour === "RED") ? " ⚠" : ""}`,
            content: <TrackerTable rows={tracker} isAdmin={isAdmin} waStatus={waByStudent} />,
          },
          /**
           * The weekly round - the in-app replacement for the Google Form that was being used to
           * collect tracker updates. Same fields, same audited write path, no sheet to reconcile.
           * Admin and Head only, matching `updateTracker`'s own `requireAdminOrHead` gate: showing
           * a form to someone the server will refuse is worse than not showing it.
           */
          ...(canEditTracker
            ? [
                {
                  label: "Weekly update",
                  content: (
                    <TrackerBatchForm
                      rows={tracker.map((t) => ({
                        enrollmentId: t.enrollmentId,
                        studentName: t.studentName,
                        programLevel: t.programLevel,
                        dayNumber: t.dayNumber,
                        totalDays: t.totalDays,
                        currentMilestone: t.currentMilestone,
                        signalColour: t.signalColour,
                        daysSinceLastSession: t.daysSinceLastSession,
                      }))}
                    />
                  ),
                },
              ]
            : []),
          { label: "All students & totals", content: <StudentsPanel rows={students} isAdmin={isAdmin} today={today} coaches={coaches} defaultCoach={defaultCoach} /> },
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
