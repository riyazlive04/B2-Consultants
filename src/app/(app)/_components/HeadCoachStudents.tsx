import Link from "next/link";
import { GraduationCap, TriangleAlert } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SectionHeading, ViewAll } from "@/components/ui/kit";
import { SIGNAL_META, signalForStudent } from "@/lib/signals";
import type { AtRiskStudent, HeadCoachSnapshot } from "@/server/head-coach-snapshot";

/**
 * The Head Coach's students row (rebuild spec §5) — "which students need me?"
 *
 * Replaces a static "Students — Open board" tile that carried no number at all: the head opened
 * their dashboard and learned nothing about the people they coach.
 *
 * The at-risk list is the point of the section, so it is a LIST, not a count. A tile reading "7 at
 * risk" tells a coach they have a problem without telling them whose; the flags underneath each
 * name are the ones the radar already derives (days since a session, overdue check-in, missed
 * sprint target, guarantee window closing).
 *
 * No financial figures anywhere — §5 is explicit about that.
 */

/** How many to name before deferring to the full board — enough to act on, short enough to read. */
const NAMED_LIMIT = 6;

/** The signal dot's colour, via the canonical palette. Unset (no coach signal yet) reads as muted,
 *  which is not the same as green — an un-assessed student is not a healthy one. */
function signalDotColour(colour: string | null): string {
  if (!colour) return "var(--ink-3)";
  return SIGNAL_META[signalForStudent(colour as "GREEN" | "AMBER" | "RED")].color;
}

function AtRiskRow({ s }: { s: AtRiskStudent }) {
  return (
    <Link
      href={`/students/${s.studentId}`}
      className="press flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 transition-colors hover:border-primary-tint hover:bg-surface-2"
    >
      <span
        className="mt-1 h-2.5 w-2.5 flex-none rounded-full"
        style={{ background: signalDotColour(s.signalColour) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold text-ink">{s.studentName}</span>
          <span className="text-caption text-muted">
            {s.programLevel.toLowerCase()} · day {s.dayNumber} of {s.totalDays}
          </span>
        </span>
        <span className="mt-1 block text-caption" style={{ color: "var(--bad)" }}>
          {s.flags.join(" · ")}
        </span>
      </span>
    </Link>
  );
}

export function HeadCoachStudents({ snapshot }: { snapshot: HeadCoachSnapshot }) {
  const named = snapshot.atRisk.slice(0, NAMED_LIMIT);
  const more = snapshot.atRisk.length - named.length;

  const atRiskBySignal = snapshot.atRisk.reduce(
    (acc, s) => {
      const key = s.signalColour ?? "UNSET";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<GraduationCap size={18} />}
        title="Your students"
        description="Who needs you, and how the cohort is moving"
        action={<ViewAll href="/students">View students</ViewAll>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active students"
          value={String(snapshot.activeStudents)}
          secondary={`${snapshot.activeGuided} guided · ${snapshot.activeElite} elite · ${snapshot.activeSolo} solo`}
          icon={<GraduationCap size={18} />}
          href="/students"
          detail={{
            rows: [
              { label: "Guided", value: snapshot.activeGuided },
              { label: "Elite", value: snapshot.activeElite },
              { label: "Solo", value: snapshot.activeSolo },
            ],
          }}
        />
        <MetricCard
          label="Needing attention"
          value={snapshot.atRisk.length === 0 ? "None" : String(snapshot.atRisk.length)}
          signal={snapshot.atRisk.length === 0 ? "ok" : "risk"}
          secondary={
            snapshot.nonResponders > 0
              ? `${snapshot.nonResponders} not responding`
              : "No one is out of contact"
          }
          tooltip="Students the early-warning radar has flagged: no recent session, an overdue check-in, a missed sprint target, or the guarantee window closing without interview-stage progress."
          icon={<TriangleAlert size={18} />}
          href="/students"
          detail={{
            rows: [
              { label: "Red", value: atRiskBySignal.RED ?? 0 },
              { label: "Amber", value: atRiskBySignal.AMBER ?? 0 },
              { label: "Green (flagged for another reason)", value: atRiskBySignal.GREEN ?? 0 },
              { label: "Not yet assessed", value: atRiskBySignal.UNSET ?? 0 },
              { label: "Not responding", value: snapshot.nonResponders },
            ],
          }}
        />
        <MetricCard
          label="Sessions delivered today"
          value={String(snapshot.sessionsDeliveredToday)}
          secondary="Auto-populated from the daily log"
          href="/daily-log"
          detail={{
            rows: snapshot.sessionsByCoach.map((c) => ({ label: c.name, value: c.sessions })),
            note: snapshot.sessionsByCoach.length === 0 ? "No sessions logged yet today." : undefined,
          }}
        />
        <MetricCard
          label="Agreements awaiting signature"
          value={String(snapshot.agreementsAwaitingSignature)}
          signal={snapshot.agreementsAwaitingSignature === 0 ? "ok" : undefined}
          secondary={
            snapshot.completedThisMonth || snapshot.droppedThisMonth
              ? `${snapshot.completedThisMonth} completed · ${snapshot.droppedThisMonth} dropped this month`
              : "Sent to the student, not signed yet"
          }
          href="/agreements"
          detail={{
            rows: [
              { label: "Sent, not yet opened", value: snapshot.agreementsSent },
              { label: "Viewed, not signed", value: snapshot.agreementsViewed },
            ],
          }}
        />
      </div>

      {named.length > 0 && (
        <div className="space-y-2.5">
          {named.map((s) => (
            <AtRiskRow key={s.studentId} s={s} />
          ))}
          {more > 0 && (
            <Link href="/students" className="block text-sm font-semibold text-primary hover:underline">
              {more} more student{more === 1 ? "" : "s"} flagged →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
