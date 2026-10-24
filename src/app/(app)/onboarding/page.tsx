import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, UserPlus, Users } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getOnboardingBoard, type OnboardingRow } from "@/server/onboarding-metrics";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState, Hint, PageHeader, Pill } from "@/components/ui/kit";
import { StudentName } from "@/components/ui/StudentName";
import { journeyHref } from "@/lib/journey-links";
import {
  JOURNEY_GAP_LABELS,
  JOURNEY_STEP_LABELS,
  JOURNEY_STEPS,
  stepNumber,
} from "@/lib/journey-state";

export const metadata = { title: "Onboarding" };
export const dynamic = "force-dynamic";

/**
 * ── ONBOARDING: one screen for lead → class ─────────────────────────────────────────────
 *
 * The journey the business runs on, which the app did not have. A person arrives as a lead,
 * takes a discovery call, accepts, pays, signs, is put in a cohort and starts class - and that
 * crossed about fifteen screens in six nav groups, with nothing joining the sales half
 * (`Lead.stage`) to the delivery half (`Student` + `Enrollment` + a seat). So no screen could say
 * where somebody had got to, and no screen could list the people stuck between stages.
 *
 * THIS IS A DOOR, not a seventh way to add a student. There were already six - a manual form, a
 * CSV import, converting a lead, enrolling off a signed agreement, approving a German Note
 * joiner, and the income form minting one while somebody recorded a bank transfer. Three of those
 * leave a `Student` with no `Enrollment`: a person who exists but has bought nothing, is in no
 * cohort, has no programme level and no login. Nothing anywhere named them.
 *
 * The "Needs completing" tab is that list, and it is why this screen earns its place: it is a GAP
 * query, not a stage query, which is only possible because `journey-state.ts` keeps gaps separate
 * from steps.
 *
 * Nothing here owns any data. Every row links to the person hub that already exists for them -
 * their student record, or their contact record before that - and every action links to the
 * screen that already does that job. The rail on those two pages (`JourneyRail`) shows the same
 * derived state, so the board and the record can never disagree.
 */
export default async function OnboardingPage() {
  await requireSection("onboarding");
  const board = await getOnboardingBoard();

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Users size={20} />}
        title="Onboarding"
        subtitle="Everyone between a first enquiry and their first class, and what each of them is waiting on."
        actions={
          /* The guided flow. One door into the journey, so nobody has to know which of the six
             screens that can create a student is the right one to start from. */
          <Link
            href="/onboarding/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong"
          >
            <UserPlus size={16} /> Add someone
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Being onboarded" value={board.inFlight.length} />
        <MetricCard
          label="Needs completing"
          value={board.needsCompleting.length}
          signal={board.needsCompleting.length > 0 ? "watch" : undefined}
        />
        <MetricCard
          label={`No movement in ${board.stuckAfterDays}+ days`}
          value={board.stuck.length}
          signal={board.stuck.length > 0 ? "watch" : undefined}
        />
        <MetricCard label="Reached class this month" value={board.doneThisMonth.length} />
      </div>

      {board.truncated && (
        <Hint>
          Showing the {board.inFlight.length + board.needsCompleting.length} most recently active
          people. Older records are still on the Contacts and Students boards.
        </Hint>
      )}

      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: `In flight (${board.inFlight.length})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  Grouped by the step each person has reached. The step is worked out from what is
                  actually recorded - a call, a booking, a signed agreement, a seat - so it is never
                  out of date.
                </Hint>
                {board.byStep.length === 0 ? (
                  <EmptyState
                    title="Nobody is being onboarded"
                    body="New enquiries appear here as soon as they arrive from a form, a funnel or the lead webhook."
                  />
                ) : (
                  board.byStep.map(({ step, rows }) => (
                    <section key={step} className="space-y-2">
                      <h2 className="flex items-center gap-2 font-display text-h3 text-ink">
                        <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-caption font-bold text-primary-strong">
                          {stepNumber(step)}
                        </span>
                        {JOURNEY_STEP_LABELS[step]}
                        <span className="text-sm font-normal text-muted">({rows.length})</span>
                      </h2>
                      <ul className="space-y-1.5">
                        {rows.map((r) => (
                          <PersonRow key={r.key} row={r} stuckAfter={board.stuckAfterDays} />
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>
            ),
          },
          {
            label: `Needs completing (${board.needsCompleting.length})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  People whose record is missing something, wherever they are in the journey. A
                  student can be created six different ways - including by recording a payment -
                  and three of those leave no programme, no cohort and no login behind.
                </Hint>
                {board.needsCompleting.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircle2 size={22} />}
                    title="Nothing half-finished"
                    body="Every person on the board has everything they need for the step they are on."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {board.needsCompleting.map((r) => (
                      <PersonRow key={r.key} row={r} stuckAfter={board.stuckAfterDays} showGaps />
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            label: `Stuck (${board.stuck.length})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  Still being onboarded, with nothing recorded against them for{" "}
                  {board.stuckAfterDays} days or more. Somebody finished is not stuck, and somebody
                  marked as not going ahead is not stuck either.
                </Hint>
                {board.stuck.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircle2 size={22} />}
                    title="Nothing is sitting still"
                    body={`Everyone in flight has had something recorded in the last ${board.stuckAfterDays} days.`}
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {board.stuck.map((r) => (
                      <PersonRow key={r.key} row={r} stuckAfter={board.stuckAfterDays} />
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            label: `Reached class (${board.doneThisMonth.length})`,
            content:
              board.doneThisMonth.length === 0 ? (
                <EmptyState
                  title="Nobody has started class this month yet"
                  body="A person lands here once they are in a cohort that has begun teaching, with nothing outstanding on their record."
                />
              ) : (
                <ul className="space-y-1.5">
                  {board.doneThisMonth.map((r) => (
                    <PersonRow key={r.key} row={r} stuckAfter={board.stuckAfterDays} />
                  ))}
                </ul>
              ),
          },
        ]}
      />
    </div>
  );
}

/**
 * One person, as a row.
 *
 * Two links, deliberately: the NAME opens the person, and "Go there" opens the screen where the
 * next action is done. Collapsing them into one would mean guessing which the reader wanted, and
 * most of the time it is the action - but when it is not, hunting for the record is exactly the
 * navigation the board is meant to remove.
 */
function PersonRow({
  row,
  stuckAfter,
  showGaps = false,
}: {
  row: OnboardingRow;
  stuckAfter: number;
  showGaps?: boolean;
}) {
  const href = journeyHref(row.journey.next.target, {
    leadId: row.leadId,
    studentId: row.studentId,
  });
  const stale = row.daysSinceActivity !== null && row.daysSinceActivity >= stuckAfter;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field border border-line bg-surface px-3 py-2.5">
      <Link href={row.href} className="min-w-0 flex-1 font-medium text-ink hover:underline">
        <StudentName name={row.name} code={row.studentCode} />
      </Link>

      {showGaps &&
        row.journey.gaps.map((gap) => (
          <Pill key={gap} tone="warn">
            {JOURNEY_GAP_LABELS[gap]}
          </Pill>
        ))}

      {stale && (
        <span className="inline-flex items-center gap-1 text-caption text-warn">
          <Clock size={12} aria-hidden />
          {row.daysSinceActivity}d quiet
        </span>
      )}

      <span className="text-caption text-muted">{row.journey.next.action}</span>

      {href ? (
        <Link
          href={href}
          className="press inline-flex flex-none items-center gap-1 rounded-field px-2 py-1 text-caption font-semibold text-primary hover:bg-primary-soft"
        >
          Go there
          <ArrowRight size={12} aria-hidden />
        </Link>
      ) : (
        row.journey.gaps.length > 0 && (
          <AlertTriangle size={14} aria-hidden className="flex-none text-warn" />
        )
      )}
    </li>
  );
}
