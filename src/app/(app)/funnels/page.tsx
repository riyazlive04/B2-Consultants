import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getFunnelsList } from "@/server/funnels-metrics";
import FunnelsList from "./_components/FunnelsList";

export const dynamic = "force-dynamic";

export default async function FunnelsPage() {
  const session = await requireSection("funnels");
  const canDelete = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const funnels = await getFunnelsList();

  return (
    <div className="w-full space-y-4">
      <ListHeader title="Funnels" count={funnels.length} subtitle="landing pages & multi-step funnels, hosted publicly" />
      <FunnelsList funnels={funnels} canDelete={canDelete} />
    </div>
  );
}
