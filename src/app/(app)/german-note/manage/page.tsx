import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getGnManageData } from "@/server/german-note-metrics";
import { getBatchCosts } from "@/server/batch-costs-metrics";
import { getActiveLevels, getAdminLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { BatchesPanel } from "../_components/BatchesPanel";
import { MembersPanel } from "../_components/MembersPanel";
import { TutorsPanel } from "../_components/TutorsPanel";
import { BatchCostsPanel } from "../_components/BatchCostsPanel";
import { LevelsPanel } from "@/components/levels/LevelsPanel";
import { PageHeader } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

export default async function GnManagePage() {
  await requireSection("german-note");
  await requireAdmin(); // belt and braces - management is Admin-only
  const [{ batches, tutors, students }, batchCosts, activeLevels, adminLevels] = await Promise.all([
    getGnManageData(),
    getBatchCosts(),
    getActiveLevels(),
    getAdminLevels(),
  ]);
  // A batch seats a single German level (never a bundle or a coaching tier).
  const germanLevelOptions = levelOptions(activeLevels, ["GERMAN_LEVEL"]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        back={{ href: "/german-note", label: "German Note" }}
        title="Manage German Note"
        subtitle="Batches, who's in them, and tutor accounts. Tutors post recordings into their own batches."
      />

      {/* Workshops moved to /german-note → Financials, where the money they make
          already lives. One home per thing. */}
      <Tabs
        tabs={[
          { label: "Batches", content: <BatchesPanel batches={batches} tutors={tutors} levelOptions={germanLevelOptions} /> },
          { label: "Members", content: <MembersPanel batches={batches} students={students} /> },
          { label: "Tutors", content: <TutorsPanel tutors={tutors} /> },
          /* German levels and bundles only. The B2 coaching tiers this tab used to list as well
             now have their own section - see /programs. */
          { label: "Levels", content: <LevelsPanel levels={adminLevels} line="GERMAN_NOTE" /> },
          { label: "Costs", content: <BatchCostsPanel rows={batchCosts} /> },
        ]}
      />
    </div>
  );
}
