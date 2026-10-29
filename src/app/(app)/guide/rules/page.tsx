import { Map as MapIcon } from "lucide-react";
import { rulesMap } from "@/lib/guide/manual";
import { SECTION_CATALOGUE } from "@/lib/sections";
import { requireAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/kit";
import { RulesExplorer } from "../_components/RulesExplorer";

export const metadata = { title: "Rules map · Guide" };
export const dynamic = "force-dynamic";

/**
 * THE RULES MAP - every rule the app lets you change, on one page, grouped by where you change it.
 *
 * The per-section manuals answer "why does this screen behave like this". This answers the
 * founder's other question, the one that comes before a change: "if I edit this setting, what else
 * moves?". Every row lists each screen that answers to it, so a commission rate that drives both
 * Finance and Bonus & Commission is visibly one rule rather than two.
 *
 * ADMIN only: nearly every destination here is the Founder Console, which no other role can open,
 * and a list of settings you cannot reach is a list of dead links.
 */
export default async function RulesMapPage() {
  await requireAdmin();
  const label = new Map<string, string>(SECTION_CATALOGUE.map((s) => [s.key, s.label]));
  const groups = rulesMap().map((g) => ({
    ...g,
    rows: g.rows.map((r) => ({
      ...r,
      usedBy: r.usedBy.map((u) => ({ ...u, sectionLabel: label.get(u.section) ?? u.section })),
    })),
  }));
  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<MapIcon size={20} />}
        back={{ href: "/guide", label: "App Guide" }}
        title="Rules map"
        subtitle={`All ${count} rules you can change, grouped by where you change them. Each one lists every screen that follows it, so you can see what will move before you touch it.`}
      />
      <RulesExplorer groups={groups} />
    </div>
  );
}
