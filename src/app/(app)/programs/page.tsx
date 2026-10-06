import { Layers } from "lucide-react";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getAdminLevels } from "@/server/levels";
import { LevelsPanel } from "@/components/levels/LevelsPanel";
import { PageHeader } from "@/components/ui/kit";

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
  const levels = await getAdminLevels();

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Layers size={18} />}
        title="Programs"
        subtitle="What B2 Consultants sells, and where each one's revenue posts. German Note's course levels are managed under German Note > Manage."
      />
      <LevelsPanel levels={levels} line="B2" />
    </div>
  );
}
