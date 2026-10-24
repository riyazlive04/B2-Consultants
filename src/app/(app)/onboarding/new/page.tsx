import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleDashed, Route } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getPersonJourney } from "@/server/onboarding-metrics";
import { Card, CardTitle, EmptyState, Hint, PageHeader, Pill } from "@/components/ui/kit";
import { JourneyRail } from "@/components/journey/JourneyRail";
import { type JourneyStep } from "@/lib/journey-state";
import { ONBOARDING_STAGES, stageOf } from "./_components/stages";
import { StartPerson } from "./_components/StartPerson";
import { MakeStudentButton } from "./_components/MakeStudentButton";

export const metadata = { title: "Add someone" };
export const dynamic = "force-dynamic";

/**
 * ── THE GUIDED FLOW: lead → discovery call → pays → signs → cohort → class ──────────────
 *
 * The founders' complaint, in their words: "there are too many sections to add a student and I
 * myself can't understand". They were right, and the count is the proof - six screens could
 * create a student, in four nav groups, and not one of them said what to do next. This is the
 * single door that walks the journey in the order the business actually runs it.
 *
 * ── Why it holds no state of its own ────────────────────────────────────────────────────
 * There is no wizard session, no draft row, no "step 3 of 6" stored anywhere. Where somebody has
 * got to is DERIVED from their records every time this page renders (`deriveJourney` in
 * lib/journey-state.ts), exactly as the agreement lifecycle is derived rather than stored.
 *
 * That is what makes it resumable for free. Close the tab at the agreement step, come back on
 * Thursday, open the same person from the board, and the wizard reads the same next action -
 * because it is reading the records, not a saved position. A stored step counter would be one
 * more thing to go stale the moment anybody did the work on the screen it points to, which is
 * exactly what we want them to do.
 *
 * ── Why it is mostly links, and why that is the right answer ────────────────────────────
 * Every step here already has a screen that does it properly - /bookings takes a booking,
 * /agreements/new drafts a contract, the cohort Roster seats learners. Re-implementing those
 * inside a wizard would mean six more write paths to keep in step with the six that exist, and
 * the capacity bug this refactor fixed is what two paths to one rule costs. So the wizard
 * ORCHESTRATES: it names the one next thing, sends you to the screen that does it, and reads
 * your progress back off the records when you return.
 *
 * The single exception is "create the student record", which had no door at all - see
 * `MakeStudentButton`.
 */


export default async function OnboardingWizardPage({
  searchParams,
}: {
  searchParams?: { lead?: string; student?: string };
}) {
  await requireSection("onboarding");

  const leadId = searchParams?.lead?.trim() || null;
  const studentId = searchParams?.student?.trim() || null;

  /*
    No person named yet: the wizard is a form. With one named, it is a journey - and the person
    may be known by either half of their identity, which is why both ids are accepted and
    `getPersonJourney` resolves the other.
  */
  const person = leadId || studentId ? await getPersonJourney({ leadId, studentId }) : null;

  return (
    <div className="w-full space-y-6">
      <div>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={13} /> Onboarding
        </Link>
        <PageHeader
          icon={<Route size={20} />}
          title={person ? person.name : "Add someone"}
          subtitle={
            person
              ? "Where they have got to, and the one thing to do next. Nothing here is saved as a step - it is read from their records, so you can stop and come back."
              : "The whole journey in one place: first enquiry, discovery call, payment, agreement, cohort, class."
          }
          actions={
            person ? <Pill tone="primary">Step {stageOf(person.journey.next.step)} of {ONBOARDING_STAGES.length}</Pill> : undefined
          }
        />
      </div>

      {/* The shape of the journey, before any of the detail. Six stages, plain words. */}
      <Card
        title={<CardTitle icon={<Route size={17} />}>How this works</CardTitle>}
        subtitle="Six stages, in the order they happen. Each one has a screen that does the work - this page sends you to the right one and keeps your place."
      >
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ONBOARDING_STAGES.map((stage, i) => {
            const reached = person ? new Set(person.journey.reached) : new Set<JourneyStep>();
            const done = person ? stage.steps.every((s) => reached.has(s)) : false;
            const current = person ? stage.steps.includes(person.journey.next.step as JourneyStep) : i === 0;
            return (
              <li
                key={stage.title}
                className={`rounded-field border p-3 ${
                  done
                    ? "border-good-soft bg-good-soft/30"
                    : current
                      ? "border-primary bg-primary-soft/40"
                      : "border-line bg-surface-2"
                }`}
              >
                <p className="flex items-center gap-1.5 text-body font-semibold text-ink">
                  {done ? (
                    <Check size={14} aria-hidden className="text-good" />
                  ) : (
                    <CircleDashed size={14} aria-hidden className="text-ink-3" />
                  )}
                  {i + 1}. {stage.title}
                  <span className="sr-only">{done ? " - done" : current ? " - you are here" : " - not started"}</span>
                </p>
                <p className="mt-0.5 text-caption text-muted">{stage.blurb}</p>
              </li>
            );
          })}
        </ol>
        <Hint>
          Payment is not one of the six, on purpose - it happens at different points for different
          people (a deposit before the contract, the balance after, sometimes instalments across
          the whole thing). It shows below as something still outstanding, wherever they are.
        </Hint>
      </Card>

      {!person && (leadId || studentId) && (
        /* An id that resolves to nobody - a stale link, or a record since archived. Say so rather
           than rendering an empty wizard that looks broken. */
        <EmptyState
          title="That person could not be found"
          body="The link may be out of date, or the record may have been archived. Start again, or find them on the board."
          action={
            <Link
              href="/onboarding/new"
              className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            >
              Start again
            </Link>
          }
        />
      )}

      {!person && !leadId && !studentId && <StartPerson />}

      {person && (
        <>
          {/*
            The same rail that is on their contact and student pages, not a wizard-shaped copy of
            it. One component, one derived state, so this screen and their record can never
            disagree about where they are.
          */}
          <JourneyRail journey={person.journey} ids={person.ids} name={person.name} />

          {/*
            THE ONE ACTION WITH NO OTHER DOOR.
            `convertLeadToStudent` was reachable only from the Contacts record, which nothing on
            the agreement or the journey mentioned - so a signed client sat as a lead. Offered
            here only when it is genuinely the next thing: they have signed, and no student record
            exists yet.
          */}
          {person.journey.next.target === "ENROL" && person.ids.leadId && !person.ids.studentId && (
            <Card
              title={<CardTitle icon={<ArrowRight size={17} />}>Next: create their student record</CardTitle>}
              subtitle="They have signed, so they can become a student. This is the step people used to miss - it was only on their contact record, and nothing pointed at it."
            >
              <MakeStudentButton leadId={person.ids.leadId} name={person.name} />
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/onboarding">
              <span className="inline-flex h-10 items-center rounded-btn border border-line px-4 text-sm font-medium hover:bg-surface-2">
                Done for now
              </span>
            </Link>
            <Link
              href="/onboarding/new"
              className="inline-flex h-10 items-center rounded-btn border border-line px-4 text-sm font-medium hover:bg-surface-2"
            >
              Add somebody else
            </Link>
            <p className="text-caption text-muted">
              Nothing is lost by leaving - they stay on the board under the step they have reached.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
