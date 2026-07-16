import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { getFunnel } from "@/server/funnels-metrics";
import { getSitesPickers } from "@/server/forms-metrics";
import FunnelBuilder from "./_components/FunnelBuilder";

export const dynamic = "force-dynamic";

export default async function FunnelBuilderPage({ params }: { params: { id: string } }) {
  await requireSection("funnels");
  const [funnel, pickers] = await Promise.all([getFunnel(params.id), getSitesPickers()]);
  if (!funnel) notFound();

  return (
    <div className="w-full">
      <FunnelBuilder funnel={funnel} forms={pickers.forms} />
    </div>
  );
}
