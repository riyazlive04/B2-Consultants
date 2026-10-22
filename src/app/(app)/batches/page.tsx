import { CalendarRange } from "lucide-react";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getBatchBoard } from "@/server/batches";
import { listCurriculumTemplates } from "@/server/curriculum";
import { BatchesManager } from "@/components/batches/BatchesManager";
import { CurriculumPanel } from "@/components/curriculum/CurriculumPanel";
import { Tabs } from "@/components/ui/Tabs";
import { Hint, PageHeader } from "@/components/ui/kit";

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
 * ADMIN-ONLY, and for the same reason the panels are: `upsertBatch` and every curriculum action
 * are `requireAdmin`. Giving the section to the head coach would draw a form the server refuses
 * - exactly the lie that the teaching desk was just corrected for. What a head coach needs is
 * on My Teaching, which now lists every cohort and lets them run any of them.
 */
export default async function BatchesPage() {
  await requireSection("batches");
  await requireAdmin();

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
                />
              </div>
            ),
          },
          {
            label: `Plans (${curricula.length})`,
            content: (
              <div className="space-y-4">
                <Hint>
                  A plan is the week-by-week sheet a cohort&apos;s timetable is built from: Week Nr, Topic,
                  Duration, Day and the time of day. Write it once, then build any number of batches from it.
                </Hint>
                <CurriculumPanel templates={curricula} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
