import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getSiteDetail } from "@/server/sites-metrics";
import SiteEditor from "./_components/SiteEditor";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: { id: string } }) {
  const session = await requireSection("sites");
  const site = await getSiteDetail(params.id);
  if (!site) notFound();

  return (
    <SiteEditor
      site={site}
      canManage={hasCapability(session.role, session.capabilities, "sites.manage")}
    />
  );
}
