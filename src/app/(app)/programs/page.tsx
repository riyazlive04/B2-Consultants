import { Layers } from "lucide-react";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getAdminLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { getTodayInrPerEur } from "@/lib/fx";
import { LevelsPanel } from "@/components/levels/LevelsPanel";
import { CurriculumPanel } from "@/components/curriculum/CurriculumPanel";
import { listCurriculumTemplates } from "@/server/curriculum";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader } from "@/components/ui/kit";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Programs" };

/**
 * Programs - the B2 Consultants half of the level catalogue.
 *
 * The catalogue used to be administered entirely from German Note > Manage > Levels, which listed
 * the B2 coaching tiers alongside the German courses. They are not the same list: a tier is what a
 * B2 client buys, a German level is a course someone sits, and `business-line.ts` already reports
 * their money separately. This page is the B2 side; German Note > Manage keeps the German side.
 *
 * Admin-only twice over, like German Note > Manage: `requireSection` honours the founder's own
 * Console toggles, and `requireAdmin` is the belt-and-braces check that editing the catalogue -
 * which moves what every level picker and GL posting in the app offers - stays with the founder.
 */

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  await requireSection("programs");
  await requireAdmin();
  // The ₹/€ price pair on each programme converts as it is typed, like every other money form.
  const [levels, fx, curricula] = await Promise.all([
    getAdminLevels(),
    getTodayInrPerEur(),
    // B2 only: German Note schedules class by class and has no week structure to template.
    listCurriculumTemplates({ line: "B2" }),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Layers size={18} />}
        title="Programs"
        subtitle="What B2 Consultants sells, and where each one's revenue posts. German Note's course levels are managed under German Note > Manage."
      />
      {/* Two things live on this page now: WHAT we sell (the level catalogue and its prices)
          and HOW we deliver it (the week-by-week curriculum a cohort's timetable is built
          from). They are the same object seen from two sides, which is why they share a screen
          rather than the curriculum getting a route of its own. */}
      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: "Programmes",
            content: <LevelsPanel levels={levels} line="B2" fxRate={Number(fx.rate)} fxStale={fx.stale} />,
          },
          {
            label: `Curriculum${curricula.length ? ` (${curricula.length})` : ""}`,
            content: <CurriculumPanel templates={curricula} levelOptions={levelOptions(levels, ["COACHING_TIER", "GERMAN_LEVEL", "OTHER"])} />,
          },
        ]}
      />
    </div>
  );
}
