import Link from "next/link";
import {
  BadgeCheck, CalendarClock, FileSearch, Mic2, Rocket, Send, Target,
} from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getMyStudentPortal, type PortalEnrollment } from "@/server/student-portal";
import { BadgeChip, JourneyRing, MomentumChip } from "@/components/ui/gamification";
import { MILESTONE_ORDER } from "@/lib/gamification";
import { formatDate } from "@/lib/format";
import { MILESTONE_LABELS, PROGRAM_LEVEL_LABELS, STUDENT_STATUS_LABELS } from "@/lib/labels";
import { SprintCheckIn } from "./_components/SprintCheckIn";

export const dynamic = "force-dynamic";

/**
 * Student portal home — the student's own gamified scoreboard. Shows ONLY what
 * student-portal.ts exposes (journey, badges, milestones, next steps); money,
 * signals and internal notes never reach this page.
 */
export default async function MyJourneyPage() {
  const session = await requireSection("my-journey");
  const portal = await getMyStudentPortal(session.user.id);

  if (!portal) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">My Journey</h1>
        <div className="mt-8 rounded-card border border-line bg-surface p-6 text-sm text-muted shadow-card">
          Your login isn&apos;t linked to a student record yet — ask your coach to connect it.
        </div>
      </div>
    );
  }

  const ordered = [
    ...(portal.primary ? [portal.primary] : []),
    ...portal.enrollments.filter((e) => e.id !== portal.primary?.id),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          My Journey
        </h1>
        <p className="mt-1 text-sm text-muted">
          {portal.fullName}
          {portal.targetRole ? ` · aiming for ${portal.targetRole} in Germany` : " · your road to Germany"} —
          every session, application and interview moves the bar.
        </p>
      </div>

      {ordered.map((e, idx) => (
        <EnrollmentJourney key={e.id} e={e} lead={idx === 0} />
      ))}

      {/* CV diagnostic — the self-serve tool students can use any time */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <FileSearch size={18} /> CV Diagnostic
            </h2>
            <p className="mt-1 text-sm text-muted">
              Paste your CV and a real German job description — get your match score, missing
              keywords and weak bullets in seconds. Nothing is stored.
            </p>
          </div>
          <Link
            href="/cv-check"
            className="rounded-field bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
          >
            Run a check
          </Link>
        </div>
      </section>
    </div>
  );
}

/** The 7-milestone path as a stepper — student-facing twin of the team's view. */
function MilestonePath({ current }: { current: string }) {
  const idx = MILESTONE_ORDER.indexOf(current as (typeof MILESTONE_ORDER)[number]);
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-y-3">
      {MILESTONE_ORDER.map((m, i) => {
        const done = i < idx;
        const active = i === idx;
        const trophy = m === "OFFER_RECEIVED" || m === "COMPLETED";
        return (
          <li key={m} className="flex items-center">
            <span
              title={MILESTONE_LABELS[m]}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold ${
                active || done ? "border-transparent text-white" : "border-line bg-surface text-muted"
              }`}
              style={{
                background: active ? "var(--accent)" : done ? "var(--ok)" : undefined,
                boxShadow: active ? "0 3px 8px rgba(var(--primary-rgb), 0.35)" : undefined,
              }}
            >
              {done ? "✓" : trophy ? "★" : i + 1}
            </span>
            <span className={`mx-1.5 hidden text-xs sm:inline ${active ? "font-semibold" : "text-muted"}`}>
              {MILESTONE_LABELS[m]}
            </span>
            {i < MILESTONE_ORDER.length - 1 && (
              <span aria-hidden className="mx-1 h-px w-4 sm:w-6" style={{ background: i < idx ? "var(--ok)" : "var(--line)" }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function EnrollmentJourney({ e, lead }: { e: PortalEnrollment; lead: boolean }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      {/* hero: ring + stage + momentum + program clock */}
      <div className="flex flex-wrap items-center gap-5">
        <JourneyRing pct={e.journey.journeyPct} stageIndex={e.journey.stageIndex} size={lead ? 88 : 64} />
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-display text-2xl font-semibold">{e.journey.stageTitle}</h2>
            <span className="text-xs text-muted">
              stage {e.journey.stageIndex + 1} of 7 · {PROGRAM_LEVEL_LABELS[e.programLevel]} program
              {e.status !== "ACTIVE" ? ` · ${STUDENT_STATUS_LABELS[e.status]}` : ""}
            </span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="tnum text-xs font-semibold text-muted">
                {e.journey.xp.toLocaleString("en-IN")} journey XP
              </p>
              <p className="tnum text-xs text-muted">{Math.round(e.journey.journeyPct)}% of the path</p>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="xp-fill h-full rounded-full" style={{ width: `${Math.max(2, e.journey.journeyPct)}%` }} />
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
            {e.journey.momentum && <MomentumChip momentum={e.journey.momentum} size="sm" />}
            {e.dayNumber !== null && e.totalDays !== null && e.status === "ACTIVE" && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                Day {e.dayNumber} of {e.totalDays}
                {e.daysLeft !== null ? ` · ${e.daysLeft} days left` : ""}
              </span>
            )}
            {e.assignedCoach && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">Coach: {e.assignedCoach}</span>
            )}
            {e.nextCheckInDate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">
                <CalendarClock size={12} /> Next check-in {formatDate(e.nextCheckInDate)}
              </span>
            )}
          </div>
        </div>
      </div>

      <MilestonePath current={e.currentMilestone} />

      {/* the numbers that move the bar */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { icon: <Rocket size={15} />, label: "Sessions", value: `${e.totalSessionsCompleted}${e.totalSessionsPlanned ? `/${e.totalSessionsPlanned}` : ""}` },
          { icon: <Send size={15} />, label: "Applications", value: String(e.applicationsSubmitted) },
          { icon: <Mic2 size={15} />, label: "Interviews", value: String(e.interviewsReceived) },
        ].map((s) => (
          <div key={s.label} className="rounded-field border border-line bg-surface-2 px-3 py-2.5 text-center">
            <p className="flex items-center justify-center gap-1 text-[11px] font-medium text-muted">
              {s.icon} {s.label}
            </p>
            <p className="mt-0.5 font-display text-xl font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* stage focus — the student's current quests */}
      {e.nextSteps && e.status === "ACTIVE" && (
        <div className="mt-5 rounded-card border border-line bg-accent-soft/60 p-4" style={{ background: "var(--accent-soft)" }}>
          <p className="flex items-center gap-2 text-sm font-semibold text-accent">
            <Target size={15} /> This stage: {e.nextSteps.focus}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {e.nextSteps.steps.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 text-accent" aria-hidden>▸</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* weekly sprint check-in (client notes: weekend form, achieved/missed) */}
      {e.status === "ACTIVE" && <SprintCheckIn weeks={e.sprintWeeks} />}

      {/* badge case */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BadgeCheck size={15} /> Badge case
          <span className="text-xs font-normal text-muted">
            {e.journey.unlockedCount}/{e.journey.badges.length} earned
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-4">
          {[...e.journey.badges]
            .sort((a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt))
            .map((b) => (
              <BadgeChip key={b.key} badge={b} />
            ))}
        </div>
      </div>

      {/* milestone timeline (dates + stages only) */}
      {e.milestoneTimeline.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-semibold">Progress history</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {[...e.milestoneTimeline].reverse().map((l) => (
              <li key={l.id} className="tnum">
                {formatDate(l.date)} — reached{" "}
                <span className="font-semibold text-ink">{MILESTONE_LABELS[l.newMilestone]}</span>
                {l.newMilestone === "OFFER_RECEIVED" ? " 🏆" : l.newMilestone === "COMPLETED" ? " 🎓" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
