import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { hasCapability, requireSection } from "@/lib/rbac";
import { getBatchBoard } from "@/server/batches";
import { BatchesManager } from "@/components/batches/BatchesManager";
import { Tabs } from "@/components/ui/Tabs";
import { Hint, PageHeader } from "@/components/ui/kit";
import { CurriculumPanel } from "@/components/curriculum/CurriculumPanel";
import { listCurriculumTemplates } from "@/server/curriculum";

export const metadata = { title: "Batches & Plans" };
export const dynamic = "force-dynamic";

/**
 * ── BATCHES & PLANS: where a cohort is created and its week is scheduled ─────────────
 *
 * Everything on this screen already existed, and that was the problem. Creating a cohort lived
 * on a tab of the Students board, the week-by-week plan a cohort is built from lived on a tab
 * of Programs, and the dates and times themselves lived on `/batches/[batchId]` - which nothing
 * linked to unless you went looking through one of the other two. Three doors, none of them
 * named after the job, for what the founders do as one sitting: write the plan, make the batch,
 * set its dates.
 *
 * So this is a DOOR, not a fourth implementation. Both panels below are the same components
 * those tabs render, reading the same server functions - there is no second copy of a batch
 * form or a curriculum editor to drift, and the existing tabs keep working for anyone who knows
 * where they are.
 *
 * ── The founders' sheet, mapped ─────────────────────────────────────────────────────
 * The timetable workbook has two halves, and so does this page:
 *   · Week Nr / Topic / Duration / Day  → the PLAN. True for every cohort that runs it, which
 *     is why it is written once as a curriculum rather than retyped per batch.
 *   · the per-batch column (Batch 14: 5/9/2026, 10:30 am …) → the cohort's own dates and times.
 *     Generated from the plan and the batch's start date, then edited class by class where a
 *     week slipped - which is what the batch's own page is for, one click from each row here.
 *
 * ── Who may be here (changed 23/10/2026, P18) ────────────────────────────────────────
 * It WAS admin-only, on the grounds that `upsertBatch` and every curriculum action are
 * `requireAdmin`, so giving the section to a head coach would draw a form the server refuses.
 * The reasoning was right and the conclusion was too broad: it also shut the only screen with a
 * ROSTER on it, which made `batches.manage` - the capability that gates seating, grantable to a
 * head coach - impossible to exercise.
 *
 * So the page is now open to a head coach holding that capability, and the write controls are
 * gated instead of the door: no create form, no edit or delete buttons, and no Plans tab. The
 * lie the old comment was avoiding is avoided per control rather than per screen.
 */
export default async function BatchesPage() {
  const session = await requireSection("batches");

  /*
    WHO MAY BE HERE, AND WHAT THEY MAY DO (P18).

    This page used to be `requireAdmin()` on top of the section, which made the `batches.manage`
    capability unexercisable: it is the capability that gates SEATING, it is grantable to a head
    coach, and the only screen with a roster was shut to them. A grantable permission that the
    role it was written for cannot exercise is not a permission, it is a decoration.

    So: the section opens the page, and what you may DO on it is read off the actions that will
    run. `upsertBatch` and `deleteBatch` are `requireAdmin()`, so creating and editing stays with
    the founder; seating is `batches.manage`, so a head coach holding it gets the list, the
    cohorts and their rosters - and no create form the server would refuse.

    A viewer with neither is bounced rather than shown an empty read-only shell: the section
    being switched on for their role is not the same as having a reason to be here.
  */
  const canEdit = session.role === "ADMIN";
  const canSeat = hasCapability(session.role, session.capabilities, "batches.manage");
  if (!canEdit && !canSeat) redirect("/?denied=batches.manage");

  const [b2, germanNote, curricula] = await Promise.all([
    getBatchBoard("B2"),
    getBatchBoard("GERMAN_NOTE"),
    // B2 only: German Note schedules class by class and has no week structure to template.
    listCurriculumTemplates({ line: "B2" }),
  ]);

  const activeOf = (rows: { status: string }[]) => rows.filter((r) => r.status === "ACTIVE").length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<CalendarRange size={20} />}
        title="Batches & Plans"
        subtitle="Create a cohort, write the plan its week runs on, and set each batch's dates and times."
      />

      {/*
        TAB ORDER IS LOAD-BEARING: 0 coaching · 1 German Note · 2 Plans.
        `lib/journey-links.ts`, the App Guide and the German Note Manage cross-link all address
        these by number (`?tab=1` is the German Note list). Plans stays LAST so that gating it
        for a non-admin cannot shift the two that are linked to.
      */}
      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: `Coaching cohorts (${activeOf(b2.rows)})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  Open a cohort to set its timetable - build the dates from a plan, then re-time any class
                  a week slipped on.
                </Hint>
                <BatchesManager
                  line="B2"
                  rows={b2.rows}
                  levelOptions={b2.levelOptions}
                  leadOptions={b2.leadOptions}
                  backKey="batches"
                  canEdit={canEdit}
                />
              </div>
            ),
          },
          {
            label: `German Note cohorts (${activeOf(germanNote.rows)})`,
            content: (
              <div className="space-y-4">
                {/* The German Note panel under its own section hardcodes a German level and
                    never sets `line`; this one asks for both and `upsertBatch` re-checks that
                    the level fits the line. Classes are still scheduled from the German Note
                    classroom, which is why these rows do not link to a timetable. */}
                <Hint>
                  German Note classes are scheduled one at a time from German Note → the cohort&apos;s
                  classroom. This is where the cohort itself is created.
                </Hint>
                <BatchesManager
                  line="GERMAN_NOTE"
                  rows={germanNote.rows}
                  levelOptions={germanNote.levelOptions}
                  leadOptions={germanNote.leadOptions}
                  backKey="batches"
                  canEdit={canEdit}
                />
              </div>
            ),
          },
          /*
            PLANS ARE ADMIN WORK, so the tab is only built for somebody who can write one.

            Every curriculum action is `requireAdmin()`. A head coach here on `batches.manage`
            needs the cohorts and their rosters; offering them an editor the server refuses is
            the same lie as the create form above. They reach the plans read-only through a
            cohort's own timetable, which is where a plan matters to them.
          */
          ...(canEdit ? [{
            label: `Plans (${curricula.length})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  A plan is the week-by-week sheet a cohort&apos;s timetable is built from: Week Nr, Topic,
                  Duration, Day and the time of day. Write it once, then build any number of batches from it.
                </Hint>
                {/*
                  THE SAME LIST AS PROGRAMS → CURRICULUM, said out loud (P9).

                  It is one component over one server function, so there is no drift risk and no
                  second copy of a plan - but a founder looking at two identical tabs on two
                  screens had no way to know that, and the honest fix for "which of these is the
                  real one" is to answer it rather than to delete a door the founders use. It is
                  here because writing the plan, making the cohort and dating it are one sitting;
                  it is there because a plan is part of what a programme IS.
                */}
                <Hint>
                  This is the same list as Programs → Curriculum - the same plans, either screen.
                  Edit them wherever you happen to be.
                </Hint>
                <CurriculumPanel templates={curricula} levelOptions={b2.levelOptions} />
              </div>
            ),
          }] : []),
        ]}
      />
    </div>
  );
}
