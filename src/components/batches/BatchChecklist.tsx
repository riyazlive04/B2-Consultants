import Link from "next/link";
import { CalendarDays, Check, GraduationCap, ListChecks, User, Users } from "lucide-react";
import { Card, CardTitle, Pill } from "@/components/ui/kit";
import { ActivateBatchButton } from "./ActivateBatchButton";
import { READINESS_TONE } from "./readiness-tone";
import {
  BATCH_PREREQUISITE_LABELS,
  BATCH_READINESS_LABELS,
  describeBlockers,
  type BatchPrerequisite,
  type BatchReadiness,
} from "@/lib/batch";

/**
 * IS THIS COHORT READY TO TEACH ANYBODY?
 *
 * The question the cohort screen could not answer. `Batch.status` holds ACTIVE or ARCHIVED, and
 * the four things a cohort needs - a plan, a teacher, dates, classes - are every one of them a
 * nullable column, so a cohort with none of them was ACTIVE from the moment it was saved and
 * looked identical to one that was running. Nobody found out until a student opened their
 * Classroom and it was empty.
 *
 * ── Why a checklist rather than a validation message ────────────────────────────────────
 * Because the work is genuinely done in several sittings, and that is not a flaw to be
 * corrected. The founders write a plan on Monday, make the cohort on Tuesday and seat people as
 * the deals close. A form that refused to save until everything was present would be a form
 * they routed around; a checklist that remembers where they got to is the same information
 * without the obstruction.
 *
 * Every unmet row LINKS at the thing that fixes it. That is the whole point - the old Roster tab
 * said "seat students into this cohort from the Students board", which was both un-clickable and
 * wrong about where the control lived.
 */

const ICONS: Record<BatchPrerequisite, typeof Check> = {
  curriculum: ListChecks,
  teacher: User,
  dates: CalendarDays,
  timetable: CalendarDays,
  learners: Users,
};

/**
 * Where each unmet prerequisite is actually fixed.
 *
 * Checked against the code rather than assumed, because a checklist that points at the wrong
 * screen is the exact failure it was built to replace - the old Roster empty state read "seat
 * students into this cohort from the Students board", and the board has no such control.
 *
 * Two of these are worth knowing:
 *
 *  · `curriculum` and `timetable` are the SAME control. `Batch.curriculumTemplateId` has one
 *    writer in the whole app - `batch-timetable-actions.ts:168` - so attaching a plan IS
 *    building the timetable from it. They stay two rows because they are two facts (a cohort can
 *    keep its template after its classes are deleted), but both lead to the same tab.
 *  · the teacher and the dates live on the batch FORM, which is a modal on Batches & Plans held
 *    in local state, not a URL. So these link to that screen's list for this line rather than
 *    pretending to deep-link into a dialog that cannot be addressed.
 */
function remedy(
  item: BatchPrerequisite,
  batchId: string,
  line: "B2" | "GERMAN_NOTE",
): { href: string; label: string } {
  // Tab order on /batches: 0 Coaching cohorts · 1 German Note cohorts · 2 Plans.
  const listTab = line === "B2" ? 0 : 1;
  switch (item) {
    case "curriculum":
      return { href: `/batches/${batchId}?tab=0`, label: "Build from a plan" };
    case "timetable":
      return { href: `/batches/${batchId}?tab=0`, label: "Build the timetable" };
    case "teacher":
      return { href: `/batches?tab=${listTab}`, label: "Assign on Batches & Plans" };
    case "dates":
      return { href: `/batches?tab=${listTab}`, label: "Set on Batches & Plans" };
    case "learners":
      return { href: `/batches/${batchId}?tab=2`, label: "Add learners" };
  }
}

/** The full five-item list, so met rows show as done rather than simply vanishing. */
const ALL: BatchPrerequisite[] = ["curriculum", "teacher", "dates", "timetable", "learners"];

export function BatchChecklist({
  batchId,
  batchName,
  line,
  readiness,
  blockers,
  canManage,
  canActivate,
}: {
  batchId: string;
  batchName: string;
  line: "B2" | "GERMAN_NOTE";
  readiness: BatchReadiness;
  blockers: BatchPrerequisite[];
  canManage: boolean;
  /**
   * The Activate gate, or `null` for a viewer who may not start a cohort.
   *
   * Deliberately separate from `canManage`. Running a cohort is `batches.manage`; STARTING one
   * writes its start date and is `requireAdmin()`, read off `activateBatch` itself. Passing
   * `canManage` here would draw a founder-only control for a head coach and let the server do
   * the explaining - the exact pattern `canSeatBatch` exists to avoid.
   */
  canActivate?: { ok: boolean; blockers: BatchPrerequisite[] } | null;
}) {
  /**
   * German Note cohorts are scheduled one class at a time from their own classroom and have no
   * week structure to template, so a plan and a built timetable are not things they are missing
   * - they are things that do not apply. `batchBlockers` already exempts them; this hides the
   * rows too, rather than showing two permanently-ticked items that were never asked for.
   */
  const items = line === "B2" ? ALL : ALL.filter((i) => i !== "curriculum" && i !== "timetable");
  const outstanding = blockers.length;

  // Nothing to say once a complete cohort is running - the checklist has served its purpose and
  // a permanent wall of ticks is just noise on a screen a coach opens every week.
  if (outstanding === 0 && (readiness === "ACTIVE" || readiness === "COMPLETED")) return null;

  /*
    START COHORT is offered while the cohort has not begun - DRAFT or READY - and never after.
    On a DRAFT it is disabled and carries the reason, which is the point: the founders could
    previously tell a cohort was unfinished only by opening four tabs and finding them empty.
  */
  const showActivate = canActivate != null && (readiness === "DRAFT" || readiness === "READY");

  return (
    <Card
      title={<CardTitle icon={<GraduationCap size={17} />}>Cohort setup</CardTitle>}
      subtitle={
        outstanding === 0
          ? "Everything is in place. This cohort is ready to start."
          : describeBlockers(blockers) + " before this cohort can teach anybody."
      }
      actions={
        <>
          <Pill tone={READINESS_TONE[readiness]}>{BATCH_READINESS_LABELS[readiness]}</Pill>
          {showActivate && (
            <ActivateBatchButton
              batchId={batchId}
              batchName={batchName}
              ok={canActivate.ok}
              blockers={canActivate.blockers}
            />
          )}
        </>
      }
    >
      <ul className="space-y-1.5">
        {items.map((item) => {
          const done = !blockers.includes(item);
          const Icon = done ? Check : ICONS[item];
          const fix = remedy(item, batchId, line);
          return (
            <li key={item} className="flex items-center gap-2.5 text-body">
              <span
                aria-hidden
                className={`grid size-5 shrink-0 place-items-center rounded-full ${
                  done ? "bg-good-soft text-good" : "bg-warn-soft text-warn"
                }`}
              >
                <Icon size={12} />
              </span>
              <span className={done ? "text-muted line-through decoration-1" : "text-ink"}>
                {BATCH_PREREQUISITE_LABELS[item]}
              </span>
              {/* A reader who cannot act on it should not be offered a link that will refuse. */}
              {!done && canManage && (
                <Link
                  href={fix.href}
                  className="ml-auto shrink-0 text-caption font-medium text-primary hover:underline"
                >
                  {fix.label}
                </Link>
              )}
              <span className="sr-only">{done ? "done" : "outstanding"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
