import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getFunnelsList } from "@/server/funnels-metrics";
import FunnelsList from "./_components/FunnelsList";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Funnels" };

export const dynamic = "force-dynamic";

export default async function FunnelsPage() {
  const session = await requireSection("funnels");
  const canDelete = hasCapability(session.role, session.capabilities, "sites.manage");
  const funnels = await getFunnelsList();

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Funnels" count={funnels.length} subtitle="landing pages & multi-step funnels, hosted publicly" />
      <FunnelsList funnels={funnels} canDelete={canDelete} />
    </div>
  );
}
