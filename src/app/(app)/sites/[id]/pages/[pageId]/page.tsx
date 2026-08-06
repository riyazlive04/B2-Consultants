import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getPageDetail } from "@/server/sites-metrics";
import PageBuilder from "./_components/PageBuilder";

export const dynamic = "force-dynamic";

export default async function SitePageEditor({
  params,
}: {
  params: { id: string; pageId: string };
}) {
  const session = await requireSection("sites");
  const page = await getPageDetail(params.pageId);
  // Guard the pairing, not just existence: /sites/A/pages/<page-of-B> must not resolve, or the
  // breadcrumb lies about which site you are editing.
  if (!page || page.siteId !== params.id) notFound();

  return (
    <PageBuilder
      page={page}
      canManage={hasCapability(session.role, session.capabilities, "sites.manage")}
    />
  );
}
