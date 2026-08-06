import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { ListHeader } from "@/components/ui/ListHeader";
import { getSitesList } from "@/server/sites-metrics";
import SitesList from "./_components/SitesList";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const session = await requireSection("sites");
  const canManage = hasCapability(session.role, session.capabilities, "sites.manage");
  const sites = await getSitesList();

  return (
    <div className="w-full space-y-4">
      <ListHeader
        title="Website"
        count={sites.length}
        subtitle="public marketing pages — published straight to the web"
      />
      <SitesList sites={sites} canManage={canManage} />
    </div>
  );
}
