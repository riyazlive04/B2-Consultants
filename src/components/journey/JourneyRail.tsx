import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleDashed, Route, XCircle } from "lucide-react";
import { Card, CardTitle, Pill } from "@/components/ui/kit";
import { journeyHref, type JourneyIds } from "@/lib/journey-links";
import {
  JOURNEY_GAP_LABELS,
  JOURNEY_STATE_LABELS,
  JOURNEY_STEPS,
  JOURNEY_STEP_LABELS,
  type Journey,
} from "@/lib/journey-state";

/**
 * ONE PERSON'S WHOLE JOURNEY, stranger to student.
 *
 * The founder's complaint, in their own words: "a student comes in as a lead then goes through
 * discovery call and then accepts pay and signs agreement, then put into batch, then class start.
 * This must be done accordingly. There are too many sections to add a student and I myself can't
 * understand."
 *
 * The journey crossed about fifteen screens in six nav groups and no screen showed where anybody
 * had got to. This is that screen - or rather, that STRIP, rendered on both person pages so the
 * answer is wherever you already are.
 *
 * ── Why it is not a new page ────────────────────────────────────────────────────────────
 * Because a third person page would make the original problem worse. There are already two -
 * `/contacts/:id` holds the sales facts, `/students/:id` the delivery ones - and the actual
 * trouble is that neither showed the whole arc. So the rail goes on both, and links between
 * them, instead of becoming a place you have to know about.
 *
 * ── Ticks, not a gate ───────────────────────────────────────────────────────────────────
 * Steps can be reached out of order and the rail shows holes rather than hiding them: people pay
 * before they sign, and a German Note learner was never a lead at all. A strictly sequential
 * display would have to call both of those broken. `deriveJourney` reads evidence per step for
 * exactly this reason.
 *
 * ── One next action, and gaps outrank progress ──────────────────────────────────────────
 * The prompt is a single button. Where somebody is further along but missing something behind
 * them - seated in a cohort with no programme level set - the gap is what it offers, because
 * telling them to wait for their first class would be useless advice. That ordering is decided
 * in `journeyNext`, not here.
 */
export function JourneyRail({
  journey,
  ids,
  name,
}: {
  journey: Journey;
  ids: JourneyIds;
  /** First name or full name - used only in the "nothing to do" line. */
  name: string;
}) {
  const reached = new Set(journey.reached);
  const lost = journey.state === "LOST";
  const href = journeyHref(journey.next.target, ids);
  const pct = Math.round(journey.progress * 100);

  return (
    <Card
      title={<CardTitle icon={<Route size={17} />}>Onboarding journey</CardTitle>}
      subtitle={
        lost
          ? "This deal is marked as not going ahead."
          : journey.complete
            ? `${name} is in class with nothing outstanding.`
            : `${reached.size} of ${JOURNEY_STEPS.length} steps done.`
      }
      actions={
        <Pill tone={lost ? "bad" : journey.complete ? "good" : "primary"}>
          {JOURNEY_STATE_LABELS[journey.state]}
        </Pill>
      }
    >
      <div className="space-y-4">
        {/*
          A progress bar AND the step list, because they answer different questions - "roughly how
          far" at a glance, and "which specific thing is missing" on a read. `aria-hidden` on the
          bar: the list below is the accessible version, so a screen reader is not read a
          percentage and then the same thing again as twelve list items.
        */}
        {!lost && (
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-[width] ${journey.complete ? "bg-good" : "bg-primary"}`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
        )}

        <ol className="flex flex-wrap gap-x-1.5 gap-y-2">
          {JOURNEY_STEPS.map((step, i) => {
            const done = reached.has(step);
            const current = journey.next.step === step;
            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold ${
                    done
                      ? "bg-good-soft text-good"
                      : current && !lost
                        ? "bg-primary-soft text-primary-strong"
                        : "bg-surface-2 text-muted"
                  }`}
                >
                  {done ? (
                    <Check size={12} aria-hidden />
                  ) : (
                    <CircleDashed size={12} aria-hidden />
                  )}
                  {JOURNEY_STEP_LABELS[step]}
                  <span className="sr-only">
                    {done ? " - done" : current ? " - next" : " - not done"}
                  </span>
                </span>
                {i < JOURNEY_STEPS.length - 1 && (
                  <ArrowRight size={11} aria-hidden className="text-ink-3" />
                )}
              </li>
            );
          })}
        </ol>

        {/*
          Gaps are listed separately from steps on purpose. They are not positions on the journey
          - they are things missing from a person at whatever position they hold, which is what
          makes "signed but never enrolled" and "seated with no login" nameable at all. Three of
          the six ways a student record can come into existence leave one of these behind.
        */}
        {journey.gaps.length > 0 && (
          <ul className="space-y-1">
            {journey.gaps.map((gap) => (
              <li key={gap} className="flex items-start gap-2 text-caption text-warn">
                <AlertTriangle size={13} aria-hidden className="mt-0.5 flex-none" />
                <span>{JOURNEY_GAP_LABELS[gap]}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="min-w-0 text-body">
            <span className="text-muted">Next: </span>
            <span className="font-medium text-ink">{journey.next.action}</span>
          </p>
          {/* No link when the action is not a place you go - waiting, or finished, or lost. */}
          {href && !lost && (
            <Link
              href={href}
              className="press inline-flex flex-none items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong"
            >
              Go there
              <ArrowRight size={14} aria-hidden />
            </Link>
          )}
          {lost && <XCircle size={16} aria-hidden className="flex-none text-bad" />}
        </div>
      </div>
    </Card>
  );
}
