import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getGnManageData } from "@/server/german-note-metrics";
import { getBatchCosts, getPendingPoolData } from "@/server/pending-pool-metrics";
import { getActiveLevels, getAdminLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { BatchesPanel } from "../_components/BatchesPanel";
import { MembersPanel } from "../_components/MembersPanel";
import { TutorsPanel } from "../_components/TutorsPanel";
import { PendingPoolPanel } from "../_components/PendingPoolPanel";
import { BatchCostsPanel } from "../_components/BatchCostsPanel";
import { LevelsPanel } from "../_components/LevelsPanel";
import { PageHeader } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

export default async function GnManagePage() {
  await requireSection("german-note");
  await requireAdmin(); // belt and braces — management is Admin-only
  const [{ batches, tutors, students }, pool, batchCosts, activeLevels, adminLevels] = await Promise.all([
    getGnManageData(),
    getPendingPoolData(),
    getBatchCosts(),
    getActiveLevels(),
    getAdminLevels(),
  ]);
  // Batches and the pending pool seat a single German level (never a bundle or a coaching tier).
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
          {
            label: `Pending pool${pool.rows.length ? ` (${pool.rows.length})` : ""}`,
            content: (
              <PendingPoolPanel
                rows={pool.rows}
                suggestions={pool.suggestions}
                batchesWithRoom={pool.batchesWithRoom}
                students={students}
                levelOptions={germanLevelOptions}
              />
            ),
          },
          { label: "Levels", content: <LevelsPanel levels={adminLevels} /> },
          { label: "Costs", content: <BatchCostsPanel rows={batchCosts} /> },
        ]}
      />
    </div>
  );
}
