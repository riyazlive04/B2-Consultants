import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getGnManageData } from "@/server/german-note-metrics";
import { getBatchCosts } from "@/server/batch-costs-metrics";
import { getActiveLevels, getAdminLevels } from "@/server/levels";
import { getTodayInrPerEur } from "@/lib/fx";
import { levelOptions } from "@/lib/levels";
import { BatchesPanel } from "../_components/BatchesPanel";
import { MembersPanel } from "../_components/MembersPanel";
import { TutorsPanel } from "../_components/TutorsPanel";
import { BatchCostsPanel } from "../_components/BatchCostsPanel";
import { LevelsPanel } from "@/components/levels/LevelsPanel";
import { PageHeader } from "@/components/ui/kit";
import { SectionLink } from "@/components/ui/SectionLink";

export const dynamic = "force-dynamic";

export default async function GnManagePage() {
  await requireSection("german-note");
  await requireAdmin(); // belt and braces - management is Admin-only
  const [{ batches, tutors, students }, batchCosts, activeLevels, adminLevels, fx] = await Promise.all([
    getGnManageData(),
    getBatchCosts(),
    getActiveLevels(),
    getAdminLevels(),
    getTodayInrPerEur(), // the ₹/€ course-fee pair on the Levels tab
  ]);
  // A batch seats a single German level (never a bundle or a coaching tier).
  const germanLevelOptions = levelOptions(activeLevels, ["GERMAN_LEVEL"]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        back={{ href: "/german-note", label: "German Note" }}
        title="Manage German Note"
        subtitle="Batches, who's in them, and tutor accounts. Tutors post recordings into their own batches."
        actions={
          /*
            THE OTHER COHORT SCREEN (refactor step E4).

            German Note cohorts can be edited here and on Batches & Plans, and the two forms are
            not the same: this one is tutor-only and has no start date, end date or batch code,
            while that one carries all three. They were left as two editors rather than merged
            behind a redirect because they are two different write paths with two different rules
            about who may lead a cohort - collapsing them would quietly widen that, which is a
            product decision and not a refactor. The link is here so the richer form is one click
            away instead of being something you had to know about.
          */
          <SectionLink href="/batches?tab=1" sectionKey="batches">
            <CalendarRange size={14} /> Dates &amp; codes on Batches &amp; plans
          </SectionLink>
        }
      />

      {/* Workshops moved to /german-note → Financials, where the money they make
          already lives. One home per thing. */}
        {/* Keeps the open tab in the address, so a refresh (or a shared link) does not drop
            back to the first tab (issue 28). */}
      <Tabs
        urlKey="tab"
        tabs={[
          { label: "Batches", content: <BatchesPanel batches={batches} tutors={tutors} levelOptions={germanLevelOptions} /> },
          { label: "Members", content: <MembersPanel batches={batches} students={students} /> },
          { label: "Tutors", content: <TutorsPanel tutors={tutors} /> },
          /* German levels and bundles only. The B2 coaching tiers this tab used to list as well
             now have their own section - see /programs. */
          {
            label: "Levels",
            content: <LevelsPanel levels={adminLevels} line="GERMAN_NOTE" fxRate={Number(fx.rate)} fxStale={fx.stale} />,
          },
          { label: "Costs", content: <BatchCostsPanel rows={batchCosts} /> },
        ]}
      />
    </div>
  );
}
